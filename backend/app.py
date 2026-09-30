# -*- coding: utf-8 -*-
"""成都智慧象留学 · 国际课程组卷系统 后端服务

Flask + SQLite 零配置实现，与学生进度追踪系统（端口 8686）同一套架构与视觉规范，
本系统独立部署在 8687 端口，可两套系统同时运行。

接口一览：
  POST /api/ping                    模式探测（前端双模式自动切换）
  POST /api/auth/login              登录并签发令牌
  POST /api/auth/logout             退出登录
  PUT  /api/me/password             修改密码
  GET  /api/bootstrap               首屏全量（身份 + 科目库 + 总览统计 + 知识点标签）

  GET  /api/questions               题库列表（科目/题型/难度/知识点/关键字/状态筛选）
  POST /api/questions               新增试题
  PUT  /api/questions/{id}          编辑试题
  DELETE /api/questions/{id}        删除试题（自动从试卷中移除）
  GET  /api/questions/template      下载 Excel 导入模板
  GET  /api/questions/export        题库导出 Excel
  POST /api/questions/import        Excel 批量导入（multipart 上传）
  GET  /api/tags                    知识点标签目录

  POST /api/papers/generate         智能组卷（按题型数量 + 难度分布分层抽取，返回预览与缺口）
  GET  /api/papers                  试卷列表
  POST /api/papers                  保存试卷（含试题明细与分值）
  GET  /api/papers/{id}             试卷详情（含试题全量，打印页使用）
  PUT  /api/papers/{id}             更新试卷（改名/改题/调分/排序）
  POST /api/papers/{id}/duplicate   复制试卷
  PUT  /api/papers/{id}/status      草稿 ↔ 定稿
  DELETE /api/papers/{id}           删除试卷

  GET  /api/stats/overview          总览统计（分布 + 最近试卷）
  GET  /api/audit                   操作审计查询

角色：admin（教学总监）/ teacher（教师），两者均可使用全部组卷功能。
启动：python backend/app.py  →  http://localhost:8687
数据：backend/zujuan.db（首次运行自动从 seed.json 建库，删除该文件即可重置）
"""
import hashlib
import json
import os
import random
import secrets
import sqlite3
from datetime import date, datetime, timedelta

from flask import Flask, g, jsonify, request, send_file, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))          # .../06-组卷系统/backend
STATIC_DIR = os.path.dirname(BASE_DIR)                          # .../06-组卷系统
DB_PATH = os.path.join(BASE_DIR, "zujuan.db")
SEED_PATH = os.path.join(BASE_DIR, "seed.json")

app = Flask(__name__, static_folder=None)

# 科目目录（与学生进度追踪系统保持一致，便于后续成绩联动）
SUBJECT_CATALOG = {
    "雅思": ["雅思听力", "雅思口语", "雅思阅读", "雅思写作"],
    "托福": ["托福阅读", "托福听力", "托福口语", "托福写作"],
    "A-Level": ["A-Level 数学", "A-Level 物理", "A-Level 化学", "A-Level 经济"],
    "AP": ["AP 微积分", "AP 物理", "AP 化学", "AP 经济学", "AP 计算机科学A"],
}

QTYPE_CATALOG = ["单选题", "多选题", "判断题", "填空题", "简答题", "写作题", "口语题"]
DIFFICULTY_LABELS = {1: "基础", 2: "较易", 3: "中等", 4: "较难", 5: "挑战"}
# 智能组卷难度分带：基础期=难度1–2，强化期=难度3，冲刺期=难度4–5
DIFFICULTY_BANDS = {"basic": (1, 2), "boost": (3, 3), "sprint": (4, 5)}
PAPER_STATUS = ("草稿", "定稿")


# ---------------- 数据库 ----------------

def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def hash_pw(password):
    return hashlib.sha256(("zhxx-zj:" + password).encode("utf-8")).hexdigest()


def ensure_schema():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,             -- admin / teacher
            name TEXT NOT NULL,
            title TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            account TEXT NOT NULL,
            role TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject TEXT NOT NULL,
            qtype TEXT NOT NULL,            -- 单选/多选/判断/填空/简答/写作/口语
            difficulty INTEGER NOT NULL DEFAULT 3,
            tags TEXT DEFAULT '',           -- 知识点，顿号分隔
            passage TEXT DEFAULT '',        -- 材料/文章/听力原文（可空）
            stem TEXT NOT NULL,             -- 题干
            options TEXT NOT NULL DEFAULT '[]',  -- JSON 数组（选择题用）
            answer TEXT DEFAULT '',         -- 答案
            explanation TEXT DEFAULT '',    -- 解析
            score REAL NOT NULL DEFAULT 0,  -- 建议分值
            duration INTEGER NOT NULL DEFAULT 0, -- 建议用时（分钟）
            source TEXT DEFAULT '',         -- 来源（剑桥真题/OG/自编等）
            status TEXT NOT NULL DEFAULT '启用',
            starred INTEGER NOT NULL DEFAULT 0,
            deleted_at TEXT,
            image_path TEXT DEFAULT '',
            created_by TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS papers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            subject_line TEXT DEFAULT '',   -- 卷面科目行，如「雅思 · 阅读」
            remark TEXT DEFAULT '',
            duration INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT '草稿',
            created_by TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS paper_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
            question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
            position INTEGER NOT NULL DEFAULT 0,
            score REAL NOT NULL DEFAULT 0,
            section TEXT DEFAULT ''         -- 分区名，空则按题型自动分组
        );
        CREATE TABLE IF NOT EXISTS subjects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            group_name TEXT DEFAULT '自定义',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            target TEXT DEFAULT '',
            detail TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS roster (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            class_name TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS blueprints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            config TEXT NOT NULL,           -- 组卷台配置 JSON
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS exams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            exam_date TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT '进行中',  -- 进行中/已完结
            created_by TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS exam_candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            class_name TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS exam_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
            candidate_id INTEGER NOT NULL REFERENCES exam_candidates(id) ON DELETE CASCADE,
            question_id INTEGER NOT NULL,
            score REAL NOT NULL DEFAULT 0,
            UNIQUE(candidate_id, question_id)
        );
        CREATE TABLE IF NOT EXISTS knowledge_nodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject TEXT NOT NULL,
            name TEXT NOT NULL,
            parent_id INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS exam_answers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
            candidate_id INTEGER NOT NULL REFERENCES exam_candidates(id) ON DELETE CASCADE,
            question_id INTEGER NOT NULL,
            answer_text TEXT DEFAULT '',
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS exam_papers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_board TEXT NOT NULL DEFAULT 'Edexcel',
            qualification TEXT NOT NULL DEFAULT 'IAL',
            subject TEXT NOT NULL DEFAULT 'Mathematics',
            paper_name TEXT NOT NULL,               -- P1 / P2
            paper_code TEXT DEFAULT '',             -- 如 WMA11/01
            year INTEGER NOT NULL,
            session TEXT DEFAULT '',                -- January / June / October
            qp_url TEXT DEFAULT '',
            ms_url TEXT DEFAULT '',
            resource_type TEXT NOT NULL DEFAULT 'owned_content',
            status TEXT NOT NULL DEFAULT 'published',   -- draft / published / disabled
            created_by TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            UNIQUE(user_id, question_id)
        );
        CREATE TABLE IF NOT EXISTS generated_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
            kind TEXT NOT NULL DEFAULT 'qp',        -- qp / ms
            url TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'success', -- pending / processing / success / failed
            created_by TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );
        """
    )
    # 旧库迁移：questions 增加收藏/回收站/配图/音频/共享/真题字段 七列；papers 增加 A/B 卷标记列
    qcols = {r[1] for r in c.execute("PRAGMA table_info(questions)").fetchall()}
    if "starred" not in qcols:
        c.execute("ALTER TABLE questions ADD COLUMN starred INTEGER NOT NULL DEFAULT 0")
    if "deleted_at" not in qcols:
        c.execute("ALTER TABLE questions ADD COLUMN deleted_at TEXT")
    if "image_path" not in qcols:
        c.execute("ALTER TABLE questions ADD COLUMN image_path TEXT DEFAULT ''")
    if "audio_path" not in qcols:
        c.execute("ALTER TABLE questions ADD COLUMN audio_path TEXT DEFAULT ''")
    if "is_public" not in qcols:
        c.execute("ALTER TABLE questions ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1")
    if "exam_paper_id" not in qcols:
        c.execute("ALTER TABLE questions ADD COLUMN exam_paper_id INTEGER")
    if "question_number" not in qcols:
        c.execute("ALTER TABLE questions ADD COLUMN question_number TEXT DEFAULT ''")
    if "sub_question" not in qcols:
        c.execute("ALTER TABLE questions ADD COLUMN sub_question TEXT DEFAULT ''")
    if "question_order" not in qcols:
        c.execute("ALTER TABLE questions ADD COLUMN question_order INTEGER NOT NULL DEFAULT 0")
    if "topic_id" not in qcols:
        c.execute("ALTER TABLE questions ADD COLUMN topic_id INTEGER")
    if "subtopic_id" not in qcols:
        c.execute("ALTER TABLE questions ADD COLUMN subtopic_id INTEGER")
    if "answer_image_url" not in qcols:
        c.execute("ALTER TABLE questions ADD COLUMN answer_image_url TEXT DEFAULT ''")
    # 知识树：真题卷维度（paper_scope）与排序
    kcols = {r[1] for r in c.execute("PRAGMA table_info(knowledge_nodes)").fetchall()}
    if "paper_scope" not in kcols:
        c.execute("ALTER TABLE knowledge_nodes ADD COLUMN paper_scope TEXT DEFAULT ''")
    if "sort_order" not in kcols:
        c.execute("ALTER TABLE knowledge_nodes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
    if "status" not in kcols:
        c.execute("ALTER TABLE knowledge_nodes ADD COLUMN status TEXT NOT NULL DEFAULT '启用'")
    # 归一化：回收站标记只允许 NULL
    c.execute("UPDATE questions SET deleted_at=NULL WHERE deleted_at=''")
    pcols = {r[1] for r in c.execute("PRAGMA table_info(papers)").fetchall()}
    if "variant" not in pcols:
        c.execute("ALTER TABLE papers ADD COLUMN variant TEXT DEFAULT ''")
    # 考试：在线答题码（空 = 未开启在线作答）；考生：答题卡照片
    ecols = {r[1] for r in c.execute("PRAGMA table_info(exams)").fetchall()}
    if "online_code" not in ecols:
        c.execute("ALTER TABLE exams ADD COLUMN online_code TEXT DEFAULT ''")
    ccols = {r[1] for r in c.execute("PRAGMA table_info(exam_candidates)").fetchall()}
    if "answer_sheet_path" not in ccols:
        c.execute("ALTER TABLE exam_candidates ADD COLUMN answer_sheet_path TEXT DEFAULT ''")
    conn.commit()
    conn.close()


def seed_if_empty():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    if c.execute("SELECT COUNT(*) FROM questions").fetchone()[0] > 0:
        conn.close()
        return
    with open(SEED_PATH, "r", encoding="utf-8") as f:
        seed = json.load(f)
    now = datetime.now().isoformat(timespec="seconds")
    for t in seed["credentials"]:
        c.execute(
            "INSERT INTO users(account,password_hash,role,name,title) VALUES(?,?,?,?,?)",
            (t["account"], hash_pw(t["password"]), t["role"], t["name"], t.get("title", "")),
        )
    for s in seed["subjects"]:
        c.execute(
            "INSERT OR IGNORE INTO subjects(name, group_name, created_at) VALUES(?,?,?)",
            (s["name"], s["group"], now),
        )
    # 真题卷元数据先行（questions 挂 FK 用）
    ep_ids = {}
    for i, ep in enumerate(seed.get("examPapers", []), start=1):
        c.execute(
            "INSERT INTO exam_papers(exam_board,qualification,subject,paper_name,paper_code,year,session,qp_url,ms_url,resource_type,status,created_by,created_at,updated_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (ep.get("examBoard", "Edexcel"), ep.get("qualification", "IAL"), ep.get("subject", "Mathematics"),
             ep["paperName"], ep.get("paperCode", ""), int(ep["year"]), ep.get("session", ""),
             ep.get("qpUrl", ""), ep.get("msUrl", ""), ep.get("resourceType", "owned_content"),
             ep.get("status", "published"), "teacher", now, now),
        )
        ep_ids[i] = c.lastrowid
    # 按卷知识树（paper_scope）先行（questions 挂 topic 用）
    kn_ids = {}
    for kp in seed.get("knowledgePaper", []):
        parent_id = 0
        if kp.get("parent"):
            parent_id = kn_ids.get((kp["paperScope"], kp["parent"]), 0)
        c.execute(
            "INSERT OR IGNORE INTO knowledge_nodes(subject,name,parent_id,paper_scope,sort_order,status,created_at)"
            " VALUES(?,?,?,?,?,?,?)",
            (kp["subject"], kp["name"], parent_id, kp.get("paperScope", ""), int(kp.get("sortOrder", 0)), "启用", now),
        )
        if not kp.get("parent"):
            kn_ids[(kp["paperScope"], kp["name"])] = c.lastrowid
    for q in seed["questions"]:
        ep_id = ep_ids.get(q.get("examPaperIndex"))
        topic_id = None
        if q.get("topicName"):
            row = c.execute(
                "SELECT id FROM knowledge_nodes WHERE name=? AND parent_id=0 LIMIT 1", (q["topicName"],)
            ).fetchone()
            topic_id = row[0] if row else None
        sub_id = None
        if q.get("subTopicName") and topic_id:
            row = c.execute(
                "SELECT id FROM knowledge_nodes WHERE name=? AND parent_id=? LIMIT 1",
                (q["subTopicName"], topic_id),
            ).fetchone()
            sub_id = row[0] if row else None
        c.execute(
            "INSERT INTO questions(subject,qtype,difficulty,tags,passage,stem,options,answer,explanation,score,duration,source,status,image_path,audio_path,is_public,exam_paper_id,question_number,sub_question,question_order,topic_id,subtopic_id,answer_image_url,created_by,created_at,updated_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                q["subject"], q["qtype"], int(q.get("difficulty", 3)), q.get("tags", ""),
                q.get("passage", ""), q["stem"], json.dumps(q.get("options", []), ensure_ascii=False),
                q.get("answer", ""), q.get("explanation", ""),
                float(q.get("score", 0)), int(q.get("duration", 0)), q.get("source", ""),
                "启用", q.get("imagePath", ""), q.get("audioPath", ""), 1 if q.get("isPublic", True) else 0,
                ep_id, q.get("questionNumber", ""), q.get("subQuestion", ""),
                int(q.get("questionOrder", 0)), topic_id, sub_id, q.get("answerImageUrl", ""),
                q.get("createdBy", "teacher"), now, now,
            ),
        )
    for p in seed.get("papers", []):
        c.execute(
            "INSERT INTO papers(name,subject_line,remark,duration,status,created_by,created_at,updated_at)"
            " VALUES(?,?,?,?,?,?,?,?)",
            (p["name"], p.get("subjectLine", ""), p.get("remark", ""),
             int(p.get("duration", 0)), p.get("status", "草稿"), p.get("createdBy", "teacher"), now, now),
        )
        pid = c.lastrowid
        for pos, item in enumerate(p.get("items", [])):
            qrow = c.execute(
                "SELECT id, score FROM questions WHERE stem=? AND subject=?", (item["stem"], item["subject"])
            ).fetchone()
            if qrow:
                c.execute(
                    "INSERT INTO paper_items(paper_id,question_id,position,score,section) VALUES(?,?,?,?,?)",
                    (pid, qrow[0], pos, float(item.get("score", qrow[1] or 0)), item.get("section", "")),
                )
    # 学生名单（全局花名册，组考试时选取）
    for s in seed.get("roster", []):
        c.execute(
            "INSERT INTO roster(name, class_name, created_at) VALUES(?,?,?)",
            (s["name"], s.get("className", ""), now),
        )
    # 组卷蓝图（存组卷台配置，一键复用）
    for b in seed.get("blueprints", []):
        c.execute(
            "INSERT INTO blueprints(name, config, created_at) VALUES(?,?,?)",
            (b["name"], json.dumps(b["config"], ensure_ascii=False), now),
        )
    # 示例考试：关联第一套试卷 + 考生 + 部分成绩（让统计报告开箱可演示）
    for ex in seed.get("exams", []):
        prow = c.execute("SELECT id FROM papers WHERE name=?", (ex["paperName"],)).fetchone()
        if not prow:
            continue
        c.execute(
            "INSERT INTO exams(paper_id,name,exam_date,remark,status,online_code,created_by,created_at)"
            " VALUES(?,?,?,?,?,?,?,?)",
            (prow[0], ex["name"], ex.get("examDate", ""), ex.get("remark", ""),
             ex.get("status", "进行中"), ex.get("onlineCode", ""), ex.get("createdBy", "teacher"), now),
        )
        eid = c.lastrowid
        for cand in ex.get("candidates", []):
            c.execute(
                "INSERT INTO exam_candidates(exam_id,name,class_name) VALUES(?,?,?)",
                (eid, cand["name"], cand.get("className", "")),
            )
            cid = c.lastrowid
            for stem, subject, score in cand.get("scores", []):
                qrow = c.execute(
                    "SELECT id FROM questions WHERE stem=? AND subject=?", (stem, subject)
                ).fetchone()
                if qrow:
                    c.execute(
                        "INSERT OR IGNORE INTO exam_scores(exam_id,candidate_id,question_id,score) VALUES(?,?,?,?)",
                        (eid, cid, qrow[0], float(score)),
                    )
    # 知识点树（两级：parent 为父节点名）
    parent_ids = {}
    for node in seed.get("knowledge", []):
        if not node.get("parent"):
            c.execute(
                "INSERT INTO knowledge_nodes(subject,name,parent_id,created_at) VALUES(?,?,0,?)",
                (node["subject"], node["name"], now),
            )
            parent_ids[(node["subject"], node["name"])] = c.lastrowid
    for node in seed.get("knowledge", []):
        if node.get("parent"):
            pid = parent_ids.get((node["subject"], node["parent"]), 0)
            c.execute(
                "INSERT INTO knowledge_nodes(subject,name,parent_id,created_at) VALUES(?,?,?,?)",
                (node["subject"], node["name"], pid, now),
            )
    conn.commit()
    conn.close()
    print(f"已初始化数据库 zujuan.db（种子试题 {len(seed['questions'])} 道、示例试卷 {len(seed.get('papers', []))} 套）")


def init_db():
    ensure_schema()
    seed_if_empty()


def log_action(user, action, target="", detail=""):
    db().execute(
        "INSERT INTO audit_log(ts, actor, action, target, detail) VALUES(?,?,?,?,?)",
        (datetime.now().isoformat(timespec="seconds"), user.get("name", "?"), action, target, detail),
    )


# ---------------- 序列化与校验 ----------------

def question_to_dict(row, with_used=False):
    try:
        options = json.loads(row["options"] or "[]")
    except (TypeError, ValueError):
        options = []
    keys = row.keys()
    out = {
        "id": row["id"],
        "subject": row["subject"],
        "qtype": row["qtype"],
        "difficulty": row["difficulty"],
        "difficultyLabel": DIFFICULTY_LABELS.get(row["difficulty"], "中等"),
        "tags": row["tags"] or "",
        "passage": row["passage"] or "",
        "stem": row["stem"],
        "options": options,
        "answer": row["answer"] or "",
        "explanation": row["explanation"] or "",
        "score": round(float(row["score"] or 0), 1),
        "duration": int(row["duration"] or 0),
        "source": row["source"] or "",
        "status": row["status"],
        "starred": bool(row["starred"]) if "starred" in keys else False,
        "imagePath": (row["image_path"] or "") if "image_path" in keys else "",
        "audioPath": (row["audio_path"] or "") if "audio_path" in keys else "",
        "isPublic": bool(row["is_public"]) if "is_public" in keys else True,
        "examPaperId": row["exam_paper_id"] if "exam_paper_id" in keys and row["exam_paper_id"] else None,
        "questionNumber": (row["question_number"] or "") if "question_number" in keys else "",
        "subQuestion": (row["sub_question"] or "") if "sub_question" in keys else "",
        "questionOrder": int(row["question_order"] or 0) if "question_order" in keys else 0,
        "topicId": row["topic_id"] if "topic_id" in keys and row["topic_id"] else None,
        "subtopicId": row["subtopic_id"] if "subtopic_id" in keys and row["subtopic_id"] else None,
        "answerImageUrl": (row["answer_image_url"] or "") if "answer_image_url" in keys else "",
        "deleted": bool(row["deleted_at"]) if "deleted_at" in keys else False,
        "createdBy": row["created_by"] or "",
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }
    if with_used:
        out["usedCount"] = db().execute(
            "SELECT COUNT(*) AS n FROM paper_items WHERE question_id=?", (row["id"],)
        ).fetchone()["n"]
    return out


def annotate_favorites(user_account, questions):
    """按当前用户批量标注 favorite 字段。"""
    if not user_account or not questions:
        return questions
    ids = [q["id"] for q in questions]
    ph = ",".join("?" * len(ids))
    rows = db().execute(
        f"SELECT question_id FROM favorites WHERE user_id=? AND question_id IN ({ph})",
        [user_account] + ids,
    ).fetchall()
    fav_ids = {r["question_id"] for r in rows}
    for q in questions:
        q["favorite"] = q["id"] in fav_ids
    return questions


def clean_options(raw):
    """选项：接受数组或按行拆分的文本，去掉空行与多余空白。"""
    if isinstance(raw, list):
        items = [str(x).strip() for x in raw]
    else:
        items = [line.strip() for line in str(raw or "").splitlines()]
    return [x for x in items if x]


def validate_question(body, existing=None):
    """新增/编辑共用校验，返回 (fields, error_response)。"""
    data = existing or {}
    subject = str(body.get("subject", data.get("subject", ""))).strip()
    qtype = str(body.get("qtype", data.get("qtype", ""))).strip()
    stem = str(body.get("stem", data.get("stem", ""))).strip()
    if not subject:
        return None, (jsonify({"error": "请选择科目"}), 400)
    if qtype not in QTYPE_CATALOG:
        return None, (jsonify({"error": "题型取值不合法"}), 400)
    if not stem:
        return None, (jsonify({"error": "题干不能为空"}), 400)
    try:
        difficulty = int(body.get("difficulty", data.get("difficulty", 3)))
    except (TypeError, ValueError):
        return None, (jsonify({"error": "难度取值不合法"}), 400)
    if difficulty not in DIFFICULTY_LABELS:
        return None, (jsonify({"error": "难度取值不合法"}), 400)
    options = clean_options(body.get("options", data.get("options", [])))
    answer = str(body.get("answer", data.get("answer", ""))).strip()
    if qtype in ("单选题", "多选题"):
        if len(options) < 2:
            return None, (jsonify({"error": "选择题至少需要 2 个选项"}), 400)
        letters = [chr(65 + i) for i in range(len(options))]
        picks = [p.strip().upper() for p in answer.replace("，", ",").split(",") if p.strip()]
        if not picks or any(p not in letters for p in picks):
            return None, (jsonify({"error": f"答案须为选项字母，如 {'、'.join(letters[:2])}"}), 400)
        if qtype == "多选题" and len(picks) < 2:
            return None, (jsonify({"error": "多选题答案至少 2 个字母"}), 400)
        answer = ",".join(picks)
    elif qtype == "判断题":
        if answer not in ("对", "错"):
            return None, (jsonify({"error": "判断题答案须为「对」或「错」"}), 400)
    elif qtype in ("填空题", "简答题", "写作题", "口语题"):
        if not answer:
            return None, (jsonify({"error": "请填写参考答案或评分要点"}), 400)
    try:
        score = round(float(body.get("score", data.get("score", 0)) or 0), 1)
        duration = int(float(body.get("duration", data.get("duration", 0)) or 0))
    except (TypeError, ValueError):
        return None, (jsonify({"error": "分值/用时应为数字"}), 400)
    if score < 0 or duration < 0:
        return None, (jsonify({"error": "分值/用时应为非负数字"}), 400)
    fields = {
        "subject": subject,
        "qtype": qtype,
        "difficulty": difficulty,
        "tags": str(body.get("tags", data.get("tags", ""))).strip(),
        "passage": str(body.get("passage", data.get("passage", ""))).strip(),
        "stem": stem,
        "options": json.dumps(options, ensure_ascii=False),
        "answer": answer,
        "explanation": str(body.get("explanation", data.get("explanation", ""))).strip(),
        "score": score,
        "duration": duration,
        "source": str(body.get("source", data.get("source", ""))).strip(),
        "status": body.get("status", data.get("status", "启用")),
        "image_path": str(body.get("imagePath", data.get("imagePath", ""))).strip(),
        "audio_path": str(body.get("audioPath", data.get("audioPath", ""))).strip(),
        "is_public": 1 if body.get("isPublic", data.get("isPublic", True)) else 0,
        "exam_paper_id": int(body["examPaperId"]) if body.get("examPaperId") else (data.get("examPaperId") or None),
        "question_number": str(body.get("questionNumber", data.get("questionNumber", ""))).strip(),
        "sub_question": str(body.get("subQuestion", data.get("subQuestion", ""))).strip(),
        "question_order": int(body.get("questionOrder") or data.get("questionOrder") or 0),
        "topic_id": int(body["topicId"]) if body.get("topicId") else (data.get("topicId") or None),
        "subtopic_id": int(body["subtopicId"]) if body.get("subtopicId") else (data.get("subtopicId") or None),
        "answer_image_url": str(body.get("answerImageUrl", data.get("answerImageUrl", ""))).strip(),
    }
    if fields["status"] not in ("启用", "停用"):
        fields["status"] = "启用"
    return fields, None


def current_user():
    header = request.headers.get("Authorization", "")
    token = header[7:] if header.startswith("Bearer ") else ""
    if not token:
        return None
    row = db().execute("SELECT * FROM sessions WHERE token=?", (token,)).fetchone()
    return dict(row) if row else None


def require_role(role="any"):
    user = current_user()
    if not user:
        return None, (jsonify({"error": "未登录或会话已过期"}), 401)
    if role == "teacher" and user["role"] not in ("teacher", "admin"):
        return None, (jsonify({"error": "需要教师权限"}), 403)
    return user, None


def subjects_payload():
    rows = db().execute("SELECT name, group_name FROM subjects ORDER BY id").fetchall()
    groups = []
    for r in rows:
        for g_ in groups:
            if g_["group"] == r["group_name"]:
                g_["items"].append(r["name"])
                break
        else:
            groups.append({"group": r["group_name"], "items": [r["name"]]})
    return groups


def ensure_subject(name):
    """题目/组卷引用了不存在的科目时自动归入「自定义」（幂等）。"""
    name = str(name or "").strip()
    if not name:
        return
    row = db().execute("SELECT 1 FROM subjects WHERE name=?", (name,)).fetchone()
    if not row:
        db().execute(
            "INSERT OR IGNORE INTO subjects(name, group_name, created_at) VALUES(?,?,?)",
            (name, "自定义", datetime.now().isoformat(timespec="seconds")),
        )


# ---------------- 静态页面（no-cache，行为同 server.py） ----------------

@app.after_request
def no_cache(resp):
    resp.headers.setdefault("Cache-Control", "no-store, no-cache, must-revalidate")
    resp.headers.setdefault("Pragma", "no-cache")
    resp.headers.setdefault("Expires", "0")
    return resp


@app.route("/", defaults={"path": "index.html"})
@app.route("/<path:path>")
def static_files(path):
    target = os.path.normpath(os.path.join(STATIC_DIR, path))
    if not target.startswith(STATIC_DIR) or not os.path.isfile(target):
        return "Not Found", 404
    return send_from_directory(STATIC_DIR, path)


# ---------------- 认证 ----------------

@app.post("/api/ping")
def ping():
    return jsonify({"ok": True, "mode": "server", "system": "zujuan"})


@app.post("/api/auth/login")
def login():
    body = request.get_json(silent=True) or {}
    account = str(body.get("account", "")).strip()
    password = str(body.get("password", ""))
    row = db().execute("SELECT * FROM users WHERE account=?", (account,)).fetchone()
    if not row or row["password_hash"] != hash_pw(password):
        return jsonify({"error": "账号或密码不正确"}), 401
    token = secrets.token_hex(16)
    conn = db()
    conn.execute(
        "INSERT INTO sessions(token,account,role,name,created_at) VALUES(?,?,?,?,?)",
        (token, row["account"], row["role"], row["name"], datetime.now().isoformat(timespec="seconds")),
    )
    log_action({"name": row["name"]}, "登录", row["account"])
    conn.commit()
    return jsonify({
        "token": token,
        "profile": {"role": row["role"], "name": row["name"], "title": row["title"] or "", "account": row["account"]},
    })


@app.post("/api/auth/logout")
def logout():
    user = current_user()
    if user:
        db().execute("DELETE FROM sessions WHERE token=?", (user["token"],))
        db().commit()
    return jsonify({"ok": True})


@app.put("/api/me/password")
def change_password():
    user, err = require_role()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    old, new = str(body.get("oldPassword", "")), str(body.get("newPassword", ""))
    if len(new) < 6:
        return jsonify({"error": "新密码至少 6 位"}), 400
    row = db().execute("SELECT password_hash FROM users WHERE account=?", (user["account"],)).fetchone()
    if not row or row["password_hash"] != hash_pw(old):
        return jsonify({"error": "原密码不正确"}), 400
    db().execute("UPDATE users SET password_hash=? WHERE account=?", (hash_pw(new), user["account"]))
    log_action(user, "修改密码", user["account"])
    db().commit()
    return jsonify({"ok": True})


@app.get("/api/bootstrap")
def bootstrap():
    user, err = require_role()
    if err:
        return err
    return jsonify({
        "profile": {"role": user["role"], "name": user["name"], "title": user.get("title", ""), "account": user["account"]},
        "subjects": subjects_payload(),
        "stats": stats_payload(),
        "tags": tags_payload(),
    })


# ---------------- 题库 ----------------

@app.get("/api/questions")
def list_questions():
    user, err = require_role()
    if err:
        return err
    conds, params = ["deleted_at IS NULL"], []
    subject = request.args.get("subject", "").strip()
    qtype = request.args.get("qtype", "").strip()
    difficulty = request.args.get("difficulty", "").strip()
    status = request.args.get("status", "").strip()
    tag = request.args.get("tag", "").strip()
    keyword = request.args.get("q", "").strip()
    starred = request.args.get("starred", "").strip()
    mine = request.args.get("mine", "").strip()
    if subject and subject != "全部科目":
        conds.append("subject=?")
        params.append(subject)
    if user["role"] != "admin":
        # 私有题仅创建者与教学总监可见
        conds.append("(is_public=1 OR created_by=?)")
        params.append(user["account"])
    if mine in ("1", "true"):
        conds.append("created_by=?")
        params.append(user["account"])
    if qtype and qtype != "全部题型":
        conds.append("qtype=?")
        params.append(qtype)
    if difficulty and difficulty not in ("全部难度", "0"):
        conds.append("difficulty=?")
        params.append(int(difficulty))
    if status and status != "全部状态":
        conds.append("status=?")
        params.append(status)
    if tag:
        conds.append("tags LIKE ?")
        params.append(f"%{tag}%")
    if starred in ("1", "true"):
        conds.append("starred=1")
    if keyword:
        conds.append("(stem LIKE ? OR passage LIKE ? OR tags LIKE ? OR answer LIKE ? OR source LIKE ?)")
        like = f"%{keyword}%"
        params += [like, like, like, like, like]
    # 真题维度筛选（知识点刷题）：真题卷/年份/考季/Topic/Subtopic，仅含有 topic 的已发布题
    exam_paper = request.args.get("exam_paper", "").strip()
    ep_year = request.args.get("year", "").strip()
    ep_session = request.args.get("session", "").strip()
    topic_id = request.args.get("topic_id", "").strip()
    subtopic_id = request.args.get("subtopic_id", "").strip()
    only_exam = request.args.get("only_exam", "").strip()
    if topic_id and topic_id != "0":
        conds.append("topic_id=?")
        params.append(int(topic_id))
    if subtopic_id and subtopic_id != "0" and subtopic_id != "all":
        conds.append("subtopic_id=?")
        params.append(int(subtopic_id))
    if only_exam == "1":
        conds.append("exam_paper_id IS NOT NULL AND topic_id IS NOT NULL")
    if exam_paper or ep_year or ep_session:
        conds.append("exam_paper_id IN (SELECT id FROM exam_papers WHERE 1=1"
                     + (" AND paper_name=?" if exam_paper else "")
                     + (" AND year=?" if ep_year else "")
                     + (" AND session=?" if ep_session else "") + ")")
        if exam_paper:
            params.append(exam_paper)
        if ep_year:
            params.append(int(ep_year))
        if ep_session:
            params.append(ep_session)
    where = " WHERE " + " AND ".join(conds)
    # 分页（知识点刷题：20 条/页）；limit 兼容旧调用
    page = max(1, int(request.args.get("page", 1) or 1))
    page_size = min(max(1, int(request.args.get("page_size", 20) or 20)), 100)
    has_page = request.args.get("page") is not None
    if has_page:
        total = db().execute(f"SELECT COUNT(*) AS n FROM questions{where}", params).fetchone()["n"]
        rows = db().execute(
            f"SELECT * FROM questions{where} ORDER BY exam_paper_id DESC, question_order, id LIMIT ? OFFSET ?",
            (*params, page_size, (page - 1) * page_size),
        ).fetchall()
        qs = [question_to_dict(r, with_used=True) for r in rows]
        annotate_favorites(user["account"], qs)
        return jsonify({"questions": qs, "total": total, "page": page, "page_size": page_size})
    limit = min(int(request.args.get("limit", 300) or 300), 1000)
    rows = db().execute(
        f"SELECT * FROM questions{where} ORDER BY id DESC LIMIT ?", (*params, limit)
    ).fetchall()
    qs = [question_to_dict(r, with_used=True) for r in rows]
    annotate_favorites(user["account"], qs)
    return jsonify({"questions": qs, "total": len(qs)})


@app.post("/api/questions")
def create_question():
    user, err = require_role("teacher")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    fields, verr = validate_question(body)
    if verr:
        return verr
    ensure_subject(fields["subject"])
    now = datetime.now().isoformat(timespec="seconds")
    conn = db()
    conn.execute(
        "INSERT INTO questions(subject,qtype,difficulty,tags,passage,stem,options,answer,explanation,score,duration,source,status,image_path,audio_path,is_public,exam_paper_id,question_number,sub_question,question_order,topic_id,subtopic_id,answer_image_url,created_by,created_at,updated_at)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (fields["subject"], fields["qtype"], fields["difficulty"], fields["tags"], fields["passage"],
         fields["stem"], fields["options"], fields["answer"], fields["explanation"], fields["score"],
         fields["duration"], fields["source"], fields["status"], fields["image_path"], fields["audio_path"],
         fields["is_public"], fields["exam_paper_id"], fields["question_number"], fields["sub_question"],
         fields["question_order"], fields["topic_id"], fields["subtopic_id"], fields["answer_image_url"],
         user["account"], now, now),
    )
    qid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    log_action(user, "新增试题", fields["subject"], f"{fields['qtype']} · {fields['stem'][:24]}")
    conn.commit()
    row = conn.execute("SELECT * FROM questions WHERE id=?", (qid,)).fetchone()
    return jsonify({"question": question_to_dict(row, with_used=True)})


@app.put("/api/questions/<int:qid>")
def update_question(qid):
    user, err = require_role("teacher")
    if err:
        return err
    row = db().execute("SELECT * FROM questions WHERE id=?", (qid,)).fetchone()
    if not row:
        return jsonify({"error": "试题不存在"}), 404
    if not row["is_public"] and user["role"] != "admin" and row["created_by"] != user["account"]:
        return jsonify({"error": "该题为他人私有题目，无权编辑"}), 403
    body = request.get_json(silent=True) or {}
    data = question_to_dict(row)
    fields, verr = validate_question(body, existing=data)
    if verr:
        return verr
    ensure_subject(fields["subject"])
    fields["updated_at"] = datetime.now().isoformat(timespec="seconds")
    conn = db()
    conn.execute(
        "UPDATE questions SET subject=?,qtype=?,difficulty=?,tags=?,passage=?,stem=?,options=?,answer=?,explanation=?,score=?,duration=?,source=?,status=?,image_path=?,audio_path=?,is_public=?,exam_paper_id=?,question_number=?,sub_question=?,question_order=?,topic_id=?,subtopic_id=?,answer_image_url=?,updated_at=? WHERE id=?",
        (fields["subject"], fields["qtype"], fields["difficulty"], fields["tags"], fields["passage"],
         fields["stem"], fields["options"], fields["answer"], fields["explanation"], fields["score"],
         fields["duration"], fields["source"], fields["status"], fields["image_path"], fields["audio_path"],
         fields["is_public"], fields["exam_paper_id"], fields["question_number"], fields["sub_question"],
         fields["question_order"], fields["topic_id"], fields["subtopic_id"], fields["answer_image_url"],
         fields["updated_at"], qid),
    )
    # 题目改动后，同步已入卷试题的分区名（按题型自动分组）
    conn.execute("UPDATE paper_items SET section=? WHERE question_id=? AND section=''", (fields["qtype"], qid))
    log_action(user, "编辑试题", fields["subject"], f"{fields['qtype']} · {fields['stem'][:24]}")
    conn.commit()
    fresh = conn.execute("SELECT * FROM questions WHERE id=?", (qid,)).fetchone()
    return jsonify({"question": question_to_dict(fresh, with_used=True)})


@app.delete("/api/questions/<int:qid>")
def delete_question(qid):
    """软删除：进回收站，可恢复；同时从所有试卷中移除。"""
    user, err = require_role("teacher")
    if err:
        return err
    row = db().execute("SELECT * FROM questions WHERE id=? AND deleted_at IS NULL", (qid,)).fetchone()
    if not row:
        return jsonify({"error": "试题不存在"}), 404
    if not row["is_public"] and user["role"] != "admin" and row["created_by"] != user["account"]:
        return jsonify({"error": "该题为他人私有题目，无权删除"}), 403
    info = question_to_dict(row)
    used = db().execute(
        "SELECT COUNT(*) AS n FROM paper_items WHERE question_id=?", (qid,)
    ).fetchone()["n"]
    conn = db()
    conn.execute("UPDATE questions SET deleted_at=? WHERE id=?",
                 (datetime.now().isoformat(timespec="seconds"), qid))
    conn.execute("DELETE FROM paper_items WHERE question_id=?", (qid,))
    log_action(user, "删除试题", info["subject"],
               f"{info['qtype']} · {info['stem'][:24]}" + (f"（同时从 {used} 套试卷移除）" if used else "（进回收站）"))
    conn.commit()
    return jsonify({"ok": True, "removedFromPapers": used})


@app.get("/api/questions/trash")
def trash_list():
    user, err = require_role()
    if err:
        return err
    rows = db().execute(
        "SELECT * FROM questions WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
    ).fetchall()
    return jsonify({"questions": [question_to_dict(r) for r in rows]})


@app.post("/api/questions/<int:qid>/restore")
def restore_question(qid):
    user, err = require_role("teacher")
    if err:
        return err
    row = db().execute("SELECT id FROM questions WHERE id=? AND deleted_at IS NOT NULL", (qid,)).fetchone()
    if not row:
        return jsonify({"error": "回收站中不存在该试题"}), 404
    db().execute("UPDATE questions SET deleted_at=NULL WHERE id=?", (qid,))
    log_action(user, "恢复试题", str(qid))
    db().commit()
    return jsonify({"ok": True})


@app.delete("/api/questions/<int:qid>/purge")
def purge_question(qid):
    """彻底删除（不可恢复）。"""
    user, err = require_role("teacher")
    if err:
        return err
    row = db().execute("SELECT stem, subject FROM questions WHERE id=? AND deleted_at IS NOT NULL", (qid,)).fetchone()
    if not row:
        return jsonify({"error": "回收站中不存在该试题"}), 404
    conn = db()
    conn.execute("DELETE FROM questions WHERE id=?", (qid,))
    log_action(user, "彻底删除试题", row["subject"], row["stem"][:24])
    conn.commit()
    return jsonify({"ok": True})


@app.post("/api/questions/empty-trash")
def empty_trash():
    user, err = require_role("teacher")
    if err:
        return err
    n = db().execute("SELECT COUNT(*) AS n FROM questions WHERE deleted_at IS NOT NULL").fetchone()["n"]
    conn = db()
    conn.execute("DELETE FROM questions WHERE deleted_at IS NOT NULL")
    log_action(user, "清空回收站", "", f"共 {n} 题")
    conn.commit()
    return jsonify({"ok": True, "purged": n})


@app.post("/api/questions/batch")
def batch_questions():
    user, err = require_role("teacher")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    ids = [int(i) for i in (body.get("ids") or []) if i]
    action = body.get("action", "")
    if not ids:
        return jsonify({"error": "请先勾选题目"}), 400
    conn = db()
    now = datetime.now().isoformat(timespec="seconds")
    if action in ("enable", "disable"):
        status = "启用" if action == "enable" else "停用"
        conn.execute(f"UPDATE questions SET status=?, updated_at=? WHERE id IN ({','.join('?' * len(ids))}) AND deleted_at IS NULL",
                     (status, now, *ids))
        log_action(user, "批量" + ("启用" if action == "enable" else "停用"), "", f"共 {len(ids)} 题")
    elif action in ("star", "unstar"):
        flag = 1 if action == "star" else 0
        conn.execute(f"UPDATE questions SET starred=?, updated_at=? WHERE id IN ({','.join('?' * len(ids))}) AND deleted_at IS NULL",
                     (flag, now, *ids))
        log_action(user, "批量收藏" if flag else "批量取消收藏", "", f"共 {len(ids)} 题")
    elif action == "delete":
        conn.execute(f"UPDATE questions SET deleted_at=?, updated_at=? WHERE id IN ({','.join('?' * len(ids))}) AND deleted_at IS NULL",
                     (now, now, *ids))
        ph = ",".join("?" * len(ids))
        conn.execute(f"DELETE FROM paper_items WHERE question_id IN ({ph})", ids)
        log_action(user, "批量删除试题", "", f"共 {len(ids)} 题（进回收站）")
    else:
        return jsonify({"error": "未知批量操作"}), 400
    conn.commit()
    return jsonify({"ok": True, "affected": len(ids)})


@app.post("/api/questions/check-dup")
def check_duplicate():
    """录题查重：题干归一化后比对启用中的题目，按序列相似度返回 ≥0.82 的候选。"""
    import difflib

    user, err = require_role()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    exclude = int(body.get("excludeId") or 0)
    norm = lambda s: "".join(ch for ch in str(s).lower() if ch.isalnum())
    target = norm(body.get("stem", ""))
    if not target:
        return jsonify({"duplicates": []})
    rows = db().execute(
        "SELECT id, subject, qtype, stem FROM questions WHERE deleted_at IS NULL" +
        (" AND id<>?" if exclude else ""), ((exclude,) if exclude else ())
    ).fetchall()
    scored = []
    for r in rows:
        cand = norm(r["stem"])
        if not cand:
            continue
        if cand == target:
            ratio = 1.0
        else:
            # 快速预筛：长度差过大或无公共字符直接跳过，避免全量对齐开销
            if abs(len(cand) - len(target)) > max(len(cand), len(target)) * 0.4:
                continue
            ratio = difflib.SequenceMatcher(None, target, cand).ratio()
        if ratio >= 0.82:
            scored.append((ratio, r))
    scored.sort(key=lambda x: -x[0])
    dups = [{"id": r["id"], "subject": r["subject"], "qtype": r["qtype"], "stem": r["stem"][:60],
             "similarity": round(rt * 100)} for rt, r in scored[:5]]
    return jsonify({"duplicates": dups})


UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
UPLOAD_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".aac", ".webm"}
DOC_EXTS = {".pdf"}


@app.post("/api/upload")
def upload_file():
    """文件上传：图片（≤5MB）、音频（≤20MB）、QP/MS PDF（≤20MB），存 backend/uploads/。"""
    user, err = require_role("teacher")
    if err:
        return err
    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify({"error": "请选择文件"}), 400
    ext = os.path.splitext(file.filename)[1].lower()
    if ext in AUDIO_EXTS:
        limit, kind = 20 * 1024 * 1024, "audio"
    elif ext in DOC_EXTS:
        limit, kind = 20 * 1024 * 1024, "file"
    elif ext in UPLOAD_EXTS:
        limit, kind = 5 * 1024 * 1024, "image"
    else:
        return jsonify({"error": "仅支持图片 / 音频 / PDF 文件"}), 400
    file.seek(0, os.SEEK_END)
    if file.tell() > limit:
        return jsonify({"error": ("音频" if kind == "audio" else "图片") + "超出大小限制"}), 400
    file.seek(0)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    fname = datetime.now().strftime("%Y%m%d%H%M%S") + "_" + secrets.token_hex(4) + ext
    file.save(os.path.join(UPLOAD_DIR, fname))
    log_action(user, "上传附件", fname, kind)
    db().commit()
    return jsonify({"path": f"backend/uploads/{fname}", "kind": kind})


@app.post("/api/blueprints")
def save_blueprint():
    user, err = require_role("teacher")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    config = body.get("config")
    if not name:
        return jsonify({"error": "请填写蓝图名称"}), 400
    if not isinstance(config, dict) or not config.get("types"):
        return jsonify({"error": "蓝图配置不完整（至少需要题型配置）"}), 400
    conn = db()
    conn.execute("INSERT INTO blueprints(name, config, created_at) VALUES(?,?,?)",
                 (name, json.dumps(config, ensure_ascii=False), datetime.now().isoformat(timespec="seconds")))
    log_action(user, "保存蓝图", name)
    conn.commit()
    return jsonify({"ok": True})


@app.get("/api/blueprints")
def list_blueprints():
    user, err = require_role()
    if err:
        return err
    rows = db().execute("SELECT * FROM blueprints ORDER BY id DESC").fetchall()
    out = []
    for r in rows:
        try:
            cfg = json.loads(r["config"])
        except (TypeError, ValueError):
            cfg = {}
        out.append({"id": r["id"], "name": r["name"], "config": cfg, "createdAt": r["created_at"]})
    return jsonify({"blueprints": out})


@app.delete("/api/blueprints/<int:bid>")
def delete_blueprint(bid):
    user, err = require_role("teacher")
    if err:
        return err
    row = db().execute("SELECT name FROM blueprints WHERE id=?", (bid,)).fetchone()
    if not row:
        return jsonify({"error": "蓝图不存在"}), 404
    db().execute("DELETE FROM blueprints WHERE id=?", (bid,))
    log_action(user, "删除蓝图", row["name"])
    db().commit()
    return jsonify({"ok": True})


# ---------------- 学生名单（全局花名册） ----------------

@app.get("/api/roster")
def roster_list():
    user, err = require_role()
    if err:
        return err
    rows = db().execute("SELECT * FROM roster ORDER BY class_name, name").fetchall()
    return jsonify({"students": [dict(r) for r in rows]})


@app.post("/api/roster")
def roster_add():
    user, err = require_role("teacher")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    added, skipped = 0, 0
    conn = db()
    now = datetime.now().isoformat(timespec="seconds")
    for item in body.get("students") or []:
        name = str(item.get("name", "")).strip()
        if not name:
            skipped += 1
            continue
        class_name = str(item.get("className", "")).strip()
        dup = conn.execute("SELECT 1 FROM roster WHERE name=? AND class_name=?", (name, class_name)).fetchone()
        if dup:
            skipped += 1
            continue
        conn.execute("INSERT INTO roster(name, class_name, created_at) VALUES(?,?,?)", (name, class_name, now))
        added += 1
    if added:
        log_action(user, "新增名单", "", f"{added} 人" + (f"，跳过 {skipped}" if skipped else ""))
    conn.commit()
    return jsonify({"added": added, "skipped": skipped})


@app.delete("/api/roster/<int:sid>")
def roster_delete(sid):
    user, err = require_role("teacher")
    if err:
        return err
    row = db().execute("SELECT name FROM roster WHERE id=?", (sid,)).fetchone()
    if not row:
        return jsonify({"error": "名单不存在"}), 404
    db().execute("DELETE FROM roster WHERE id=?", (sid,))
    log_action(user, "移除名单", row["name"])
    db().commit()
    return jsonify({"ok": True})


# ---------------- 知识点树形大纲 ----------------

def knowledge_tree():
    rows = db().execute("SELECT * FROM knowledge_nodes ORDER BY subject, parent_id, id").fetchall()
    tree = {}
    for r in rows:
        tree.setdefault(r["subject"], []).append(dict(r))
    out = []
    for subject, nodes in tree.items():
        parents = [n for n in nodes if not n["parent_id"]]
        children = {n["parent_id"]: [] for n in nodes}
        for n in nodes:
            if n["parent_id"]:
                children.setdefault(n["parent_id"], []).append(n)
        out.append({
            "subject": subject,
            "nodes": [{
                "id": p["id"], "name": p["name"],
                "children": [{"id": ch["id"], "name": ch["name"]} for ch in children.get(p["id"], [])]
            } for p in parents],
        })
    return out


@app.get("/api/knowledge")
def knowledge_list():
    user, err = require_role()
    if err:
        return err
    return jsonify({"tree": knowledge_tree()})


@app.post("/api/knowledge")
def knowledge_add():
    user, err = require_role("teacher")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    subject = str(body.get("subject", "")).strip()
    name = str(body.get("name", "")).strip()
    parent_id = int(body.get("parentId") or 0)
    if not subject or not name:
        return jsonify({"error": "科目与知识点名称不能为空"}), 400
    if parent_id:
        prow = db().execute("SELECT subject, parent_id FROM knowledge_nodes WHERE id=?", (parent_id,)).fetchone()
        if not prow or prow["parent_id"]:
            return jsonify({"error": "父节点不存在（仅支持两级）"}), 400
        if prow["subject"] != subject:
            return jsonify({"error": "子节点须与父节点同科目"}), 400
    dup = db().execute(
        "SELECT 1 FROM knowledge_nodes WHERE subject=? AND name=? AND parent_id=?",
        (subject, name, parent_id),
    ).fetchone()
    if dup:
        return jsonify({"error": "该知识点已存在"}), 409
    db().execute(
        "INSERT INTO knowledge_nodes(subject,name,parent_id,created_at) VALUES(?,?,?,?)",
        (subject, name, parent_id, datetime.now().isoformat(timespec="seconds")),
    )
    log_action(user, "新增知识点", subject, name)
    db().commit()
    return jsonify({"tree": knowledge_tree()})


@app.delete("/api/knowledge/<int:kid>")
def knowledge_delete(kid):
    user, err = require_role("teacher")
    if err:
        return err
    row = db().execute("SELECT subject, name FROM knowledge_nodes WHERE id=?", (kid,)).fetchone()
    if not row:
        return jsonify({"error": "知识点不存在"}), 404
    conn = db()
    conn.execute("DELETE FROM knowledge_nodes WHERE id=? OR parent_id=?", (kid, kid))
    log_action(user, "删除知识点", row["subject"], row["name"])
    conn.commit()
    return jsonify({"tree": knowledge_tree()})


@app.get("/api/tags")
def tags_payload_route():
    user, err = require_role()
    if err:
        return err
    return jsonify({"tags": tags_payload()})


def tags_payload():
    names = set()
    for r in db().execute("SELECT tags FROM questions WHERE tags<>''").fetchall():
        for t in (r["tags"] or "").replace("，", "、").split("、"):
            t = t.strip()
            if t:
                names.add(t)
    return sorted(names)


# ---------------- 智能组卷 ----------------

@app.post("/api/papers/generate")
def generate_paper():
    user, err = require_role("teacher")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    subjects = [str(s).strip() for s in (body.get("subjects") or []) if str(s).strip()]
    type_rows = body.get("types") or []
    if not type_rows:
        return jsonify({"error": "请至少配置一种题型"}), 400
    try:
        dist = body.get("dist") or {}
        pct = {
            "basic": max(0, float(dist.get("basic", 0))),
            "boost": max(0, float(dist.get("boost", 0))),
            "sprint": max(0, float(dist.get("sprint", 0))),
        }
    except (TypeError, ValueError):
        return jsonify({"error": "难度分布须为数字"}), 400
    total_pct = pct["basic"] + pct["boost"] + pct["sprint"]
    if total_pct <= 0:
        pct = {"basic": 0, "boost": 100, "sprint": 0}  # 未填则默认中等难度为主
    else:
        pct = {k: v / total_pct * 100 for k, v in pct.items()}
    tags = [str(t).strip() for t in (body.get("tags") or []) if str(t).strip()]
    try:
        exclude_ids = {int(x) for x in (body.get("excludeIds") or [])}
    except (TypeError, ValueError):
        exclude_ids = set()

    selected, shortage = [], []
    used_ids = set(exclude_ids)  # 平行卷：避开排除的题目
    for tr in type_rows:
        qtype = str(tr.get("qtype", "")).strip()
        try:
            count = max(0, int(tr.get("count", 0)))
        except (TypeError, ValueError):
            count = 0
        try:
            per_score = round(float(tr.get("score", 0) or 0), 1)
        except (TypeError, ValueError):
            per_score = 0.0
        if qtype not in QTYPE_CATALOG or count <= 0:
            continue
        conds = ["qtype=?", "status='启用'", "deleted_at IS NULL", "(is_public=1 OR created_by=?)"]
        params = [qtype, user["account"]]
        if subjects:
            conds.append("subject IN (%s)" % ",".join("?" * len(subjects)))
            params += subjects
        pool = db().execute(
            f"SELECT * FROM questions WHERE {' AND '.join(conds)}", params
        ).fetchall()
        if exclude_ids:
            pool = [r for r in pool if r["id"] not in exclude_ids]
        # 指定了知识点时优先命中，不足再放宽到全部
        if tags:
            hit = [r for r in pool if any(t in (r["tags"] or "") for t in tags)]
            if len(hit) >= count:
                pool = hit
        picked = stratified_pick(pool, count, pct)
        if len(picked) < count:
            shortage.append({"qtype": qtype, "requested": count, "got": len(picked), "pool": len(pool)})
        for r in picked:
            if r["id"] in used_ids:
                continue
            used_ids.add(r["id"])
            d = question_to_dict(r)
            d["assignScore"] = per_score
            selected.append(d)
    # 分布偏离提示：回补导致实际难度分层偏离设定比例时如实告知
    dist_note = ""
    if selected and total_pct > 0:
        bands_n = {"basic": 0, "boost": 0, "sprint": 0}
        for q in selected:
            for band, (lo, hi) in DIFFICULTY_BANDS.items():
                if lo <= q["difficulty"] <= hi:
                    bands_n[band] += 1
                    break
        actual = {k: v / len(selected) * 100 for k, v in bands_n.items()}
        want = {k: v / total_pct * 100 for k, v in pct.items()}
        label = {"basic": "基础", "boost": "强化", "sprint": "冲刺"}
        parts = [f"{label[k]} {round(actual[k])}%（设定 {round(want[k])}%）"
                 for k in ("basic", "boost", "sprint")
                 if abs(actual[k] - want[k]) > 10]
        if parts:
            dist_note = "题库该范围内难度层题量不足，实际分布：" + "、".join(parts)
    return jsonify({"questions": selected, "shortage": shortage, "distNote": dist_note})


def stratified_pick(pool, count, pct):
    """按难度分带比例分层随机抽取；某层不足时由其余层回补。"""
    if not pool or count <= 0:
        return []
    strata = {"basic": [], "boost": [], "sprint": []}
    for r in pool:
        d = r["difficulty"]
        for band, (lo, hi) in DIFFICULTY_BANDS.items():
            if lo <= d <= hi:
                strata[band].append(r)
                break
    targets = {}
    remain = count
    order = sorted(pct, key=lambda k: -pct[k])
    for i, band in enumerate(order):
        if i == len(order) - 1:
            targets[band] = remain
        else:
            targets[band] = min(remain, int(round(count * pct[band] / 100.0)))
            remain -= targets[band]
    picked = []
    for band in order:
        candidates = [r for r in strata[band] if r["id"] not in {p["id"] for p in picked}]
        take = min(targets[band], len(candidates))
        if take > 0:
            picked += random.sample(candidates, take)
    if len(picked) < count:  # 回补：从剩余题目中随机补齐
        rest = [r for r in pool if r["id"] not in {p["id"] for p in picked}]
        if rest:
            picked += random.sample(rest, min(count - len(picked), len(rest)))
    return picked[:count]


# ---------------- 试卷 ----------------

def paper_meta_to_dict(row, with_counts=True):
    conn = db()
    out = {
        "id": row["id"],
        "name": row["name"],
        "subjectLine": row["subject_line"] or "",
        "remark": row["remark"] or "",
        "duration": int(row["duration"] or 0),
        "status": row["status"],
        "variant": (row["variant"] or "") if "variant" in row.keys() else "",
        "createdBy": row["created_by"] or "",
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }
    if with_counts:
        agg = conn.execute(
            "SELECT COUNT(*) AS n, COALESCE(SUM(score),0) AS s FROM paper_items WHERE paper_id=?",
            (row["id"],),
        ).fetchone()
        out["questionCount"] = agg["n"]
        out["totalScore"] = round(float(agg["s"] or 0), 1)
    return out


def paper_full(pid):
    row = db().execute("SELECT * FROM papers WHERE id=?", (pid,)).fetchone()
    if not row:
        return None
    paper = paper_meta_to_dict(row, with_counts=False)
    items = db().execute(
        "SELECT pi.id AS item_id, pi.position, pi.score, pi.section, q.*"
        " FROM paper_items pi JOIN questions q ON q.id=pi.question_id"
        " WHERE pi.paper_id=? ORDER BY pi.position, pi.id",
        (pid,),
    ).fetchall()
    items_out = []
    total = 0.0
    for r in items:
        q = question_to_dict(r)
        score = round(float(r["score"] or 0), 1)
        total += score
        items_out.append({
            "itemId": r["item_id"],
            "position": r["position"],
            "score": score,
            "section": r["section"] or q["qtype"],
            "question": q,
        })
    paper["items"] = items_out
    paper["questionCount"] = len(items_out)
    paper["totalScore"] = round(total, 1)
    return paper


def save_paper_items(conn, pid, items):
    """items: [{questionId, score, section}]，position 按数组顺序。"""
    conn.execute("DELETE FROM paper_items WHERE paper_id=?", (pid,))
    for pos, it in enumerate(items):
        qid = int(it.get("questionId", 0))
        if not qid:
            continue
        qrow = conn.execute("SELECT qtype FROM questions WHERE id=?", (qid,)).fetchone()
        if not qrow:
            continue
        section = str(it.get("section", "")).strip() or qrow["qtype"]
        try:
            score = round(float(it.get("score", 0) or 0), 1)
        except (TypeError, ValueError):
            score = 0.0
        conn.execute(
            "INSERT INTO paper_items(paper_id,question_id,position,score,section) VALUES(?,?,?,?,?)",
            (pid, qid, pos, score, section),
        )


@app.get("/api/papers")
def list_papers():
    user, err = require_role()
    if err:
        return err
    rows = db().execute("SELECT * FROM papers ORDER BY updated_at DESC, id DESC").fetchall()
    return jsonify({"papers": [paper_meta_to_dict(r) for r in rows]})


@app.get("/api/papers/<int:pid>")
def get_paper(pid):
    user, err = require_role()
    if err:
        return err
    paper = paper_full(pid)
    if not paper:
        return jsonify({"error": "试卷不存在"}), 404
    return jsonify({"paper": paper})


@app.post("/api/papers")
def create_paper():
    user, err = require_role("teacher")
    if err:
        return err
    return upsert_paper(None, user)


@app.put("/api/papers/<int:pid>")
def update_paper(pid):
    user, err = require_role("teacher")
    if err:
        return err
    row = db().execute("SELECT 1 FROM papers WHERE id=?", (pid,)).fetchone()
    if not row:
        return jsonify({"error": "试卷不存在"}), 404
    return upsert_paper(pid, user)


def upsert_paper(pid, user):
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    if not name:
        return jsonify({"error": "请填写试卷名称"}), 400
    items = body.get("items") or []
    if not items:
        return jsonify({"error": "试卷至少需要一道试题"}), 400
    subject_line = str(body.get("subjectLine", "")).strip()
    remark = str(body.get("remark", "")).strip()
    try:
        duration = max(0, int(float(body.get("duration", 0) or 0)))
    except (TypeError, ValueError):
        return jsonify({"error": "建议时长须为数字"}), 400
    status = body.get("status", "草稿")
    if status not in PAPER_STATUS:
        status = "草稿"
    variant = str(body.get("variant", "")).strip()[:10]
    now = datetime.now().isoformat(timespec="seconds")
    conn = db()
    if pid is None:
        conn.execute(
            "INSERT INTO papers(name,subject_line,remark,duration,status,variant,created_by,created_at,updated_at)"
            " VALUES(?,?,?,?,?,?,?,?,?)",
            (name, subject_line, remark, duration, status, variant, user["account"], now, now),
        )
        pid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        log_action(user, "新建试卷", name, f"共 {len(items)} 题" + (f"（{variant}）" if variant else ""))
    else:
        conn.execute(
            "UPDATE papers SET name=?,subject_line=?,remark=?,duration=?,status=?,variant=?,updated_at=? WHERE id=?",
            (name, subject_line, remark, duration, status, variant, now, pid),
        )
        log_action(user, "编辑试卷", name, f"共 {len(items)} 题")
    save_paper_items(conn, pid, items)
    conn.commit()
    return jsonify({"paper": paper_full(pid)})


@app.post("/api/papers/<int:pid>/duplicate")
def duplicate_paper(pid):
    user, err = require_role("teacher")
    if err:
        return err
    src = paper_full(pid)
    if not src:
        return jsonify({"error": "试卷不存在"}), 404
    now = datetime.now().isoformat(timespec="seconds")
    conn = db()
    new_name = src["name"] + "（副本）"
    conn.execute(
        "INSERT INTO papers(name,subject_line,remark,duration,status,created_by,created_at,updated_at)"
        " VALUES(?,?,?,?,?,?,?,?)",
        (new_name, src["subjectLine"], src["remark"], src["duration"], "草稿", user["account"], now, now),
    )
    new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    save_paper_items(conn, new_id,
                     [{"questionId": it["question"]["id"], "score": it["score"], "section": it["section"]}
                      for it in src["items"]])
    log_action(user, "复制试卷", new_name, f"源自「{src['name']}」")
    conn.commit()
    return jsonify({"paper": paper_full(new_id)})


@app.put("/api/papers/<int:pid>/status")
def set_paper_status(pid):
    user, err = require_role("teacher")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    status = body.get("status")
    if status not in PAPER_STATUS:
        return jsonify({"error": "状态取值不合法"}), 400
    row = db().execute("SELECT name FROM papers WHERE id=?", (pid,)).fetchone()
    if not row:
        return jsonify({"error": "试卷不存在"}), 404
    db().execute("UPDATE papers SET status=?, updated_at=? WHERE id=?",
                 (status, datetime.now().isoformat(timespec="seconds"), pid))
    log_action(user, "试卷定稿" if status == "定稿" else "试卷转草稿", row["name"])
    db().commit()
    return jsonify({"paper": paper_full(pid)})


@app.delete("/api/papers/<int:pid>")
def delete_paper(pid):
    user, err = require_role("teacher")
    if err:
        return err
    row = db().execute("SELECT name FROM papers WHERE id=?", (pid,)).fetchone()
    if not row:
        return jsonify({"error": "试卷不存在"}), 404
    conn = db()
    conn.execute("DELETE FROM papers WHERE id=?", (pid,))
    log_action(user, "删除试卷", row["name"])
    conn.commit()
    return jsonify({"ok": True})


# ---------------- 考试与成绩 ----------------

def exam_meta_to_dict(row, with_agg=True):
    conn = db()
    out = {
        "id": row["id"],
        "paperId": row["paper_id"],
        "name": row["name"],
        "examDate": row["exam_date"] or "",
        "remark": row["remark"] or "",
        "status": row["status"],
        "onlineCode": (row["online_code"] or "") if "online_code" in row.keys() else "",
        "createdBy": row["created_by"] or "",
        "createdAt": row["created_at"],
    }
    paper = conn.execute("SELECT name, subject_line FROM papers WHERE id=?", (row["paper_id"],)).fetchone()
    out["paperName"] = paper["name"] if paper else "（试卷已删除）"
    out["subjectLine"] = paper["subject_line"] if paper else ""
    if with_agg:
        out["candidateCount"] = conn.execute(
            "SELECT COUNT(*) AS n FROM exam_candidates WHERE exam_id=?", (row["id"],)
        ).fetchone()["n"]
        total = conn.execute(
            "SELECT COALESCE(SUM(score),0) AS s FROM paper_items WHERE paper_id=?", (row["paper_id"],)
        ).fetchone()["s"]
        out["totalScore"] = round(float(total or 0), 1)
        agg = conn.execute(
            "SELECT COUNT(DISTINCT candidate_id) AS m, COALESCE(SUM(score),0) AS s FROM exam_scores WHERE exam_id=?",
            (row["id"],),
        ).fetchone()
        out["enteredCandidates"] = agg["m"]
        out["enteredSum"] = round(float(agg["s"] or 0), 1)
        out["avgScore"] = round(agg["s"] / agg["m"], 1) if agg["m"] else None
    return out


@app.get("/api/exams")
def list_exams():
    user, err = require_role()
    if err:
        return err
    rows = db().execute("SELECT * FROM exams ORDER BY id DESC").fetchall()
    return jsonify({"exams": [exam_meta_to_dict(r) for r in rows]})


@app.post("/api/exams")
def create_exam():
    user, err = require_role("teacher")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    paper_id = int(body.get("paperId") or 0)
    if not name:
        return jsonify({"error": "请填写考试名称"}), 400
    paper = db().execute("SELECT id, name FROM papers WHERE id=?", (paper_id,)).fetchone()
    if not paper:
        return jsonify({"error": "请选择关联试卷"}), 400
    candidates = body.get("candidates") or []
    if not candidates:
        return jsonify({"error": "请至少选择或录入一名考生"}), 400
    conn = db()
    now = datetime.now().isoformat(timespec="seconds")
    online = bool(body.get("online"))
    code = "".join(secrets.choice("23456789ABCDEFGHJKMNPQRSTUVWXYZ") for _ in range(6)) if online else ""
    conn.execute(
        "INSERT INTO exams(paper_id,name,exam_date,remark,status,online_code,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
        (paper_id, name, str(body.get("examDate", "")).strip(), str(body.get("remark", "")).strip(),
         "进行中", code, user["account"], now),
    )
    eid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    for cand in candidates:
        cname = str(cand.get("name", "")).strip()
        if not cname:
            continue
        conn.execute(
            "INSERT INTO exam_candidates(exam_id,name,class_name) VALUES(?,?,?)",
            (eid, cname, str(cand.get("className", "")).strip()),
        )
    log_action(user, "新建考试", name, f"试卷「{paper['name']}」，考生 {len(candidates)} 人")
    conn.commit()
    row = conn.execute("SELECT * FROM exams WHERE id=?", (eid,)).fetchone()
    return jsonify({"exam": exam_meta_to_dict(row)})


@app.get("/api/exams/<int:eid>")
def get_exam(eid):
    user, err = require_role()
    if err:
        return err
    row = db().execute("SELECT * FROM exams WHERE id=?", (eid,)).fetchone()
    if not row:
        return jsonify({"error": "考试不存在"}), 404
    exam = exam_meta_to_dict(row, with_agg=False)
    conn = db()
    items = conn.execute(
        "SELECT pi.question_id AS qid, pi.position, pi.score, pi.section, q.qtype, q.stem, q.difficulty, q.tags"
        " FROM paper_items pi JOIN questions q ON q.id=pi.question_id"
        " WHERE pi.paper_id=? ORDER BY pi.position, pi.id",
        (row["paper_id"],),
    ).fetchall()
    exam["items"] = [{
        "questionId": r["qid"], "position": r["position"], "fullScore": round(float(r["score"] or 0), 1),
        "section": r["section"] or r["qtype"], "qtype": r["qtype"],
        "stem": r["stem"][:50], "difficulty": r["difficulty"], "tags": r["tags"] or "",
    } for r in items]
    candidates = conn.execute(
        "SELECT * FROM exam_candidates WHERE exam_id=? ORDER BY id", (eid,)
    ).fetchall()
    entered = {r["candidate_id"]: (r["n"], r["s"]) for r in conn.execute(
        "SELECT candidate_id, COUNT(*) AS n, COALESCE(SUM(score),0) AS s FROM exam_scores WHERE exam_id=? GROUP BY candidate_id",
        (eid,),
    ).fetchall()}
    qn = len(items)
    exam["candidates"] = [{
        "id": r["id"], "name": r["name"], "className": r["class_name"] or "",
        "sheetPath": (r["answer_sheet_path"] or "") if "answer_sheet_path" in r.keys() else "",
        "enteredCount": entered.get(r["id"], (0, 0))[0],
        "questionCount": qn,
        "totalScore": round(entered.get(r["id"], (0, 0))[1], 1),
    } for r in candidates]
    scores = conn.execute(
        "SELECT candidate_id, question_id, score FROM exam_scores WHERE exam_id=?", (eid,)
    ).fetchall()
    exam["scores"] = [{"candidateId": r["candidate_id"], "questionId": r["question_id"],
                       "score": round(float(r["score"] or 0), 1)} for r in scores]
    # 在线提交的主观题作答原文（批阅用）
    ans_rows = conn.execute(
        "SELECT candidate_id, question_id, answer_text FROM exam_answers WHERE exam_id=?", (eid,)
    ).fetchall()
    exam["answers"] = [{"candidateId": r["candidate_id"], "questionId": r["question_id"],
                        "answerText": r["answer_text"] or ""} for r in ans_rows]
    return jsonify({"exam": exam})


@app.put("/api/exams/<int:eid>")
def update_exam(eid):
    user, err = require_role("teacher")
    if err:
        return err
    row = db().execute("SELECT * FROM exams WHERE id=?", (eid,)).fetchone()
    if not row:
        return jsonify({"error": "考试不存在"}), 404
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", row["name"])).strip() or row["name"]
    status = body.get("status", row["status"])
    if status not in ("进行中", "已完结"):
        status = row["status"]
    code = row["online_code"] if "online_code" in row.keys() else ""
    if body.get("online") and not code:
        code = "".join(secrets.choice("23456789ABCDEFGHJKMNPQRSTUVWXYZ") for _ in range(6))
    if body.get("online") is False:
        code = ""
    db().execute(
        "UPDATE exams SET name=?, exam_date=?, remark=?, status=?, online_code=? WHERE id=?",
        (name, str(body.get("examDate", row["exam_date"])).strip(),
         str(body.get("remark", row["remark"])).strip(), status, code, eid),
    )
    log_action(user, "编辑考试", name)
    db().commit()
    fresh = db().execute("SELECT * FROM exams WHERE id=?", (eid,)).fetchone()
    return jsonify({"exam": exam_meta_to_dict(fresh)})


@app.delete("/api/exams/<int:eid>")
def delete_exam(eid):
    user, err = require_role("teacher")
    if err:
        return err
    row = db().execute("SELECT name FROM exams WHERE id=?", (eid,)).fetchone()
    if not row:
        return jsonify({"error": "考试不存在"}), 404
    conn = db()
    conn.execute("DELETE FROM exams WHERE id=?", (eid,))
    log_action(user, "删除考试", row["name"])
    conn.commit()
    return jsonify({"ok": True})


@app.put("/api/exams/<int:eid>/scores")
def save_exam_scores(eid):
    """按考生批量保存得分：scores 为 {questionId: 数值}，值为 null 表示清除该格。"""
    user, err = require_role("teacher")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    candidate_id = int(body.get("candidateId") or 0)
    scores = body.get("scores") or {}
    cand = db().execute(
        "SELECT name FROM exam_candidates WHERE id=? AND exam_id=?", (candidate_id, eid)
    ).fetchone()
    if not cand:
        return jsonify({"error": "考生不存在"}), 404
    # 校验分值上限（以试卷明细为准）
    full = {r["question_id"]: float(r["score"] or 0) for r in db().execute(
        "SELECT question_id, score FROM paper_items WHERE paper_id=?",
        (db().execute("SELECT paper_id FROM exams WHERE id=?", (eid,)).fetchone()[0],),
    ).fetchall()}
    conn = db()
    saved = 0
    for qid_raw, val in scores.items():
        qid = int(qid_raw)
        if qid not in full:
            continue
        if val is None or val == "":
            conn.execute("DELETE FROM exam_scores WHERE candidate_id=? AND question_id=?", (candidate_id, qid))
            continue
        try:
            v = round(float(val), 1)
        except (TypeError, ValueError):
            continue
        v = max(0.0, min(v, full[qid]))  # 超出满分按满分截断
        conn.execute(
            "INSERT INTO exam_scores(exam_id,candidate_id,question_id,score) VALUES(?,?,?,?)"
            " ON CONFLICT(candidate_id, question_id) DO UPDATE SET score=excluded.score",
            (eid, candidate_id, qid, v),
        )
        saved += 1
    conn.commit()
    agg = conn.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(score),0) AS s FROM exam_scores WHERE candidate_id=?",
        (candidate_id,),
    ).fetchone()
    return jsonify({"saved": saved, "enteredCount": agg["n"], "totalScore": round(float(agg["s"] or 0), 1)})


# ---------------- 备份与恢复 ----------------

@app.get("/api/backup")
def backup_all():
    user, err = require_role("teacher")
    if err:
        return err
    conn = db()
    payload = {
        "meta": {"system": "zujuan", "exportedAt": datetime.now().isoformat(timespec="seconds")},
        "questions": [dict(r) for r in conn.execute("SELECT * FROM questions ORDER BY id").fetchall()],
        "papers": [dict(r) for r in conn.execute("SELECT * FROM papers ORDER BY id").fetchall()],
        "paper_items": [dict(r) for r in conn.execute("SELECT * FROM paper_items ORDER BY id").fetchall()],
        "subjects": [dict(r) for r in conn.execute("SELECT * FROM subjects ORDER BY id").fetchall()],
        "roster": [dict(r) for r in conn.execute("SELECT * FROM roster ORDER BY id").fetchall()],
        "blueprints": [dict(r) for r in conn.execute("SELECT * FROM blueprints ORDER BY id").fetchall()],
        "exams": [dict(r) for r in conn.execute("SELECT * FROM exams ORDER BY id").fetchall()],
        "exam_candidates": [dict(r) for r in conn.execute("SELECT * FROM exam_candidates ORDER BY id").fetchall()],
        "exam_scores": [dict(r) for r in conn.execute("SELECT * FROM exam_scores ORDER BY id").fetchall()],
    }
    data = json.dumps(payload, ensure_ascii=False, indent=1)
    log_action(user, "导出备份", "", f"题目 {len(payload['questions'])}、试卷 {len(payload['papers'])}、考试 {len(payload['exams'])}")
    db().commit()
    import io
    blob = io.BytesIO(data.encode("utf-8"))
    return send_file(blob, as_attachment=True,
                     download_name=f"组卷系统备份_{date.today().isoformat()}.json",
                     mimetype="application/json")


@app.post("/api/restore")
def restore_all():
    """整库恢复（覆盖现有题目/试卷/考试/名单/蓝图，账号与会话不动）。"""
    user, err = require_role("teacher")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    data = body.get("data") or {}
    required = ("questions", "papers", "paper_items")
    if any(k not in data for k in required):
        return jsonify({"error": "备份文件不完整（缺少必要数据表）"}), 400
    conn = db()
    for table in ("exam_scores", "exam_candidates", "exams", "blueprints", "roster",
                  "paper_items", "papers", "questions", "subjects"):
        conn.execute(f"DELETE FROM {table}")
    def rows(key, cols):
        out = []
        for r in data.get(key) or []:
            out.append([r.get(c) for c in cols])
        return out
    conn.executemany(
        "INSERT INTO questions(id,subject,qtype,difficulty,tags,passage,stem,options,answer,explanation,score,duration,source,status,starred,deleted_at,image_path,audio_path,is_public,created_by,created_at,updated_at)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rows("questions", ["id", "subject", "qtype", "difficulty", "tags", "passage", "stem", "options", "answer",
                           "explanation", "score", "duration", "source", "status", "starred", "deleted_at",
                           "image_path", "audio_path", "is_public", "created_by", "created_at", "updated_at"]),
    )
    conn.executemany(
        "INSERT INTO papers(id,name,subject_line,remark,duration,status,variant,created_by,created_at,updated_at)"
        " VALUES(?,?,?,?,?,?,?,?,?,?)",
        rows("papers", ["id", "name", "subject_line", "remark", "duration", "status", "variant",
                        "created_by", "created_at", "updated_at"]),
    )
    conn.executemany(
        "INSERT INTO paper_items(id,paper_id,question_id,position,score,section) VALUES(?,?,?,?,?,?)",
        rows("paper_items", ["id", "paper_id", "question_id", "position", "score", "section"]),
    )
    conn.executemany(
        "INSERT INTO subjects(id,name,group_name,created_at) VALUES(?,?,?,?)",
        rows("subjects", ["id", "name", "group_name", "created_at"]),
    )
    conn.executemany(
        "INSERT INTO roster(id,name,class_name,created_at) VALUES(?,?,?,?)",
        rows("roster", ["id", "name", "class_name", "created_at"]),
    )
    conn.executemany(
        "INSERT INTO blueprints(id,name,config,created_at) VALUES(?,?,?,?)",
        rows("blueprints", ["id", "name", "config", "created_at"]),
    )
    conn.executemany(
        "INSERT INTO exams(id,paper_id,name,exam_date,remark,status,online_code,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        rows("exams", ["id", "paper_id", "name", "exam_date", "remark", "status", "online_code", "created_by", "created_at"]),
    )
    conn.executemany(
        "INSERT INTO exam_candidates(id,exam_id,name,class_name) VALUES(?,?,?,?)",
        rows("exam_candidates", ["id", "exam_id", "name", "class_name"]),
    )
    conn.executemany(
        "INSERT INTO exam_scores(id,exam_id,candidate_id,question_id,score) VALUES(?,?,?,?,?)",
        rows("exam_scores", ["id", "exam_id", "candidate_id", "question_id", "score"]),
    )
    conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('questions','papers','paper_items','subjects','roster','blueprints','exams','exam_candidates','exam_scores')")
    log_action(user, "恢复备份", "", f"题目 {len(data.get('questions') or [])}、试卷 {len(data.get('papers') or [])}")
    conn.commit()
    return jsonify({"ok": True})


# ---------------- 统计 ----------------

def stats_payload():
    conn = db()
    week_ago = (datetime.now() - timedelta(days=7)).isoformat(timespec="seconds")
    total = conn.execute("SELECT COUNT(*) AS n FROM questions WHERE deleted_at IS NULL").fetchone()["n"]
    enabled = conn.execute("SELECT COUNT(*) AS n FROM questions WHERE status='启用' AND deleted_at IS NULL").fetchone()["n"]
    week_new = conn.execute("SELECT COUNT(*) AS n FROM questions WHERE created_at>=? AND deleted_at IS NULL", (week_ago,)).fetchone()["n"]
    papers_count = conn.execute("SELECT COUNT(*) AS n FROM papers").fetchone()["n"]
    by_type = {r["qtype"]: r["n"] for r in
               conn.execute("SELECT qtype, COUNT(*) AS n FROM questions WHERE deleted_at IS NULL GROUP BY qtype").fetchall()}
    by_diff = {str(r["difficulty"]): r["n"] for r in
               conn.execute("SELECT difficulty, COUNT(*) AS n FROM questions WHERE deleted_at IS NULL GROUP BY difficulty").fetchall()}
    by_subject = [{"subject": r["subject"], "n": r["n"]} for r in
                  conn.execute("SELECT subject, COUNT(*) AS n FROM questions WHERE deleted_at IS NULL GROUP BY subject ORDER BY n DESC").fetchall()]
    recent = [paper_meta_to_dict(r) for r in
              conn.execute("SELECT * FROM papers ORDER BY updated_at DESC, id DESC LIMIT 5").fetchall()]
    # 近 8 周趋势：新增题目 / 新建试卷
    def weekly_counts(table):
        buckets = []
        today = date.today()
        for i in range(7, -1, -1):
            week_start = today - timedelta(days=today.weekday() + 7 * i)
            week_end = week_start + timedelta(days=6)
            lo, hi = week_start.isoformat(), week_end.isoformat()
            n = conn.execute(
                f"SELECT COUNT(*) AS n FROM {table} WHERE substr(created_at,1,10) BETWEEN ? AND ?",
                (lo, hi),
            ).fetchone()["n"]
            buckets.append({"label": f"{week_start.month}/{week_start.day}", "n": n})
        return buckets
    top_used = [{"stem": (r["stem"] or "")[:36], "subject": r["subject"], "n": r["n"]} for r in conn.execute(
        "SELECT q.stem, q.subject, COUNT(pi.id) AS n FROM paper_items pi"
        " JOIN questions q ON q.id=pi.question_id GROUP BY pi.question_id ORDER BY n DESC LIMIT 5"
    ).fetchall()]
    return {
        "totalQuestions": total, "enabledQuestions": enabled, "weekNew": week_new,
        "totalPapers": papers_count,
        "byType": by_type, "byDifficulty": by_diff, "bySubject": by_subject,
        "recentPapers": recent,
        "weeklyQuestions": weekly_counts("questions"),
        "weeklyPapers": weekly_counts("papers"),
        "topUsed": top_used,
        "trashCount": conn.execute("SELECT COUNT(*) AS n FROM questions WHERE deleted_at IS NOT NULL").fetchone()["n"],
        "examCount": conn.execute("SELECT COUNT(*) AS n FROM exams").fetchone()["n"],
    }


@app.get("/api/stats/overview")
def stats_overview():
    user, err = require_role()
    if err:
        return err
    return jsonify({"stats": stats_payload()})


# ---------------- Excel 导入导出 ----------------

IMPORT_COLUMNS = ["科目", "题型", "难度(1-5)", "知识点(顿号分隔)", "材料与文章(可空)", "题干",
                  "选项(每行一个)", "答案", "解析(可空)", "建议分值", "建议用时(分钟)", "来源(可空)"]


@app.get("/api/questions/template")
def questions_template():
    user, err = require_role("teacher")
    if err:
        return err
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    wb = Workbook()
    ws = wb.active
    ws.title = "题库导入"
    header_fill = PatternFill("solid", fgColor="12233A")
    header_font = Font(name="微软雅黑", size=10, bold=True, color="FFFFFF")
    thin = Side(style="thin", color="D9D2C0")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    ws.append(IMPORT_COLUMNS)
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.border = border
        cell.alignment = Alignment(horizontal="center", vertical="center")
    example = [
        "雅思阅读", "判断题", 3, "TRUE-FALSE-NOT GIVEN",
        "The Canary Islands were so named not after the songbirds that now bear their name, but after the packs of large dogs that Roman explorers encountered there.",
        "The islands got their name from songbirds that lived there.",
        "", "错",
        "原文明确说群岛得名于罗马探险者遇到的狗，而非金丝雀，属于与原文相矛盾的表述。",
        2, 2, "自编示例",
    ]
    ws.append(example)
    widths = [13, 9, 10, 22, 46, 40, 30, 12, 40, 9, 12, 14]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[chr(64 + i)].width = w
    # 填写说明放独立 sheet，避免导入时被当成数据行
    tips_ws = wb.create_sheet("填写说明")
    tips = [
        "填写说明：",
        "1. 只在「题库导入」表中按列填写，每行一道题；示例行导入前请删除或替换。",
        "2. 题型仅支持：" + "、".join(QTYPE_CATALOG),
        "3. 难度 1-5（1 基础 / 2 较易 / 3 中等 / 4 较难 / 5 挑战）",
        "4. 选择题选项写在同一单元格内、每行一个（Alt+Enter 换行），答案填字母，如 A 或 A,C",
        "5. 判断题答案填「对」或「错」；填空/简答/写作/口语题填参考答案或评分要点",
        "6. 「知识点」用顿号分隔，多个知识点便于智能组卷按点抽题",
    ]
    for i, t in enumerate(tips, start=1):
        tips_ws.cell(row=i, column=1, value=t)
    tips_ws.column_dimensions["A"].width = 90
    path = os.path.join(BASE_DIR, "import_template.xlsx")
    wb.save(path)
    return send_file(path, as_attachment=True, download_name="题库导入模板.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.get("/api/questions/export")
def questions_export():
    user, err = require_role("teacher")
    if err:
        return err
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    wb = Workbook()
    ws = wb.active
    ws.title = "题库"
    header_fill = PatternFill("solid", fgColor="12233A")
    header_font = Font(name="微软雅黑", size=10, bold=True, color="FFFFFF")
    body_font = Font(name="微软雅黑", size=10)
    thin = Side(style="thin", color="D9D2C0")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    ws.append(IMPORT_COLUMNS + ["状态", "录入人", "录入时间"])
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.border = border
        cell.alignment = Alignment(horizontal="center", vertical="center")
    rows = db().execute("SELECT * FROM questions WHERE deleted_at IS NULL ORDER BY subject, qtype, id").fetchall()
    exported = 0
    for r in rows:
        q = question_to_dict(r)
        ws.append([
            q["subject"], q["qtype"], q["difficulty"], q["tags"], q["passage"], q["stem"],
            "\n".join(q["options"]), q["answer"], q["explanation"], q["score"], q["duration"],
            q["source"], q["status"], q["createdBy"], q["createdAt"][:10],
        ])
        exported += 1
    widths = [13, 9, 10, 22, 46, 40, 30, 12, 40, 9, 12, 14, 8, 10, 12]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[chr(64 + i)].width = w
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.font = body_font
            cell.border = border
            cell.alignment = Alignment(vertical="center", wrap_text=True)
    ws.freeze_panes = "A2"
    path = os.path.join(BASE_DIR, "export_tmp.xlsx")
    wb.save(path)
    log_action(user, "导出题库", "", f"共 {exported} 题")
    db().commit()
    return send_file(path, as_attachment=True, download_name=f"国际课程题库_{date.today().isoformat()}.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.post("/api/questions/import")
def questions_import():
    user, err = require_role("teacher")
    if err:
        return err
    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify({"error": "请选择要导入的 Excel 文件"}), 400
    from openpyxl import load_workbook

    try:
        wb = load_workbook(file, read_only=True, data_only=True)
    except Exception:
        return jsonify({"error": "文件无法解析，请使用下载的 Excel 模板填写"}), 400
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    if not rows:
        return jsonify({"error": "表格为空"}), 400
    header = [str(h or "").strip() for h in rows[0]]
    col = {}
    for key in IMPORT_COLUMNS:
        # 模板列名允许去掉括号说明后匹配（如「难度」匹配「难度(1-5)」）
        base = key.split("(")[0]
        for i, h in enumerate(header):
            if h == key or h == base or h.startswith(base + "("):
                col[key] = i
                break
    missing = [k for k in ("科目", "题型", "题干", "答案") if k not in col]
    if missing:
        return jsonify({"error": "缺少必需列：" + "、".join(missing)}), 400
    now = datetime.now().isoformat(timespec="seconds")
    conn = db()
    added, errors = 0, []
    for ln, raw in enumerate(rows[1:], start=2):
        if raw is None or not any(str(v or "").strip() for v in raw):
            continue
        getv = lambda name: (str(raw[col[name]]).strip() if name in col and raw[col[name]] is not None else "")
        subject = getv("科目")
        qtype = getv("题型")
        stem = getv("题干")
        if not subject or not stem:
            errors.append(f"第{ln}行：科目或题干为空，已跳过")
            continue
        if qtype not in QTYPE_CATALOG:
            errors.append(f"第{ln}行：题型「{qtype or '空'}」不合法，已跳过")
            continue
        diff_raw = getv("难度(1-5)") or "3"
        try:
            difficulty = int(float(diff_raw))
        except (TypeError, ValueError):
            difficulty = 3
        if difficulty not in DIFFICULTY_LABELS:
            difficulty = 3
        options_raw = raw[col["选项(每行一个)"]] if "选项(每行一个)" in col and raw[col["选项(每行一个)"]] is not None else ""
        options = clean_options(str(options_raw).replace("\r\n", "\n").split("\n"))
        answer = getv("答案")
        ok, ans_err = True, ""
        if qtype in ("单选题", "多选题"):
            letters = [chr(65 + i) for i in range(max(len(options), 0))]
            picks = [p.strip().upper() for p in answer.replace("，", ",").split(",") if p.strip()]
            if len(options) < 2:
                ok, ans_err = False, "选择题选项不足 2 个"
            elif not picks or any(p not in letters for p in picks):
                ok, ans_err = False, f"答案 {answer or '空'} 不是合法选项字母"
            elif qtype == "多选题" and len(picks) < 2:
                ok, ans_err = False, "多选题答案至少 2 个字母"
            else:
                answer = ",".join(picks)
        elif qtype == "判断题" and answer not in ("对", "错"):
            ok, ans_err = False, "判断题答案须为「对」或「错」"
        elif qtype != "判断题" and not answer:
            ok, ans_err = False, "答案为空"
        if not ok:
            errors.append(f"第{ln}行：{ans_err}，已跳过")
            continue
        try:
            score = round(float(getv("建议分值") or 0), 1)
        except (TypeError, ValueError):
            score = 0.0
        try:
            duration = int(float(getv("建议用时(分钟)") or 0))
        except (TypeError, ValueError):
            duration = 0
        ensure_subject(subject)
        conn.execute(
            "INSERT INTO questions(subject,qtype,difficulty,tags,passage,stem,options,answer,explanation,score,duration,source,status,created_by,created_at,updated_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (subject, qtype, difficulty, getv("知识点(顿号分隔)"), getv("材料与文章(可空)"), stem,
             json.dumps(options, ensure_ascii=False), answer, getv("解析(可空)"), score, duration,
             getv("来源(可空)") or "Excel导入", "启用", user["account"], now, now),
        )
        added += 1
    conn.commit()
    log_action(user, "导入题库", file.filename, f"成功 {added} 题，跳过 {len(errors)} 行")
    conn.commit()
    return jsonify({"added": added, "skipped": len(errors), "errors": errors[:50]})


# ---------------- 学生在线答题（免登录，答题码校验） ----------------

def objective_verdict(q, ans):
    """客观题判定：返回 (得分, 满分)。多选全对满分、漏选半分、错选 0。"""
    full = float(q["score"] or 0)
    if ans is None or str(ans).strip() == "":
        return 0.0, full
    if q["qtype"] == "判断题":
        return (full if str(ans).strip() == str(q["answer"]).strip() else 0.0), full
    if q["qtype"] == "单选题":
        return (full if str(ans).strip().upper() == str(q["answer"]).strip().upper() else 0.0), full
    if q["qtype"] == "多选题":
        pick = sorted(set(p.strip().upper() for p in str(ans).replace("，", ",").split(",") if p.strip()))
        truth = sorted(set(p.strip().upper() for p in str(q["answer"]).replace("，", ",").split(",") if p.strip()))
        if not pick:
            return 0.0, full
        if pick == truth:
            return full, full
        if set(pick) <= set(truth):
            return round(full / 2, 1), full  # 漏选
        return 0.0, full  # 错选
    return None, full  # 主观题


@app.post("/api/online/verify")
def online_verify():
    """学生进入答题：答题码 + 姓名（须在考生名单中）；examId 可选（0 时按码全局查找）。"""
    body = request.get_json(silent=True) or {}
    exam_id = int(body.get("examId") or 0)
    code = str(body.get("code", "")).strip().upper()
    name = str(body.get("name", "")).strip()
    if exam_id:
        row = db().execute("SELECT * FROM exams WHERE id=?", (exam_id,)).fetchone()
    else:
        row = db().execute("SELECT * FROM exams WHERE UPPER(online_code)=? ORDER BY id DESC", (code,)).fetchone()
    if not row or not row["online_code"]:
        return jsonify({"error": "考试不存在或未开启在线作答"}), 404
    if (row["online_code"] or "").upper() != code:
        return jsonify({"error": "答题码不正确"}), 403
    if row["status"] != "进行中":
        return jsonify({"error": "该考试已结束作答"}), 403
    exam_id = row["id"]  # 按码进入时回填真实考试 id
    cand = db().execute(
        "SELECT * FROM exam_candidates WHERE exam_id=? AND name=?", (exam_id, name)
    ).fetchone()
    if not cand:
        return jsonify({"error": "姓名不在考生名单中，请联系老师"}), 404
    paper = db().execute("SELECT name, subject_line, duration FROM papers WHERE id=?", (row["paper_id"],)).fetchone()
    items = db().execute(
        "SELECT pi.question_id AS qid, pi.position, pi.score, pi.section,"
        " q.qtype, q.passage, q.stem, q.options, q.audio_path, q.image_path, q.duration"
        " FROM paper_items pi JOIN questions q ON q.id=pi.question_id"
        " WHERE pi.paper_id=? ORDER BY pi.position, pi.id",
        (row["paper_id"],),
    ).fetchall()
    questions = []
    for r in items:
        try:
            options = json.loads(r["options"] or "[]")
        except (TypeError, ValueError):
            options = []
        questions.append({
            "questionId": r["qid"], "qtype": r["qtype"], "passage": r["passage"] or "",
            "stem": r["stem"], "options": options, "fullScore": round(float(r["score"] or 0), 1),
            "audioPath": r["audio_path"] or "", "imagePath": r["image_path"] or "",
            "duration": int(r["duration"] or 0),
        })
    log_action({"name": name}, "在线作答", row["name"], f"考生 {name}")
    db().commit()
    return jsonify({
        "candidateId": cand["id"],
        "exam": {"name": row["name"], "paperName": paper["name"] if paper else "",
                 "subjectLine": paper["subject_line"] if paper else "", "duration": paper["duration"] if paper else 0},
        "questions": questions,
    })


@app.post("/api/online/submit")
def online_submit():
    """学生交卷：客观题即时判分写入成绩，主观题存作答原文待教师批阅。"""
    body = request.get_json(silent=True) or {}
    exam_id = int(body.get("examId") or 0)
    code = str(body.get("code", "")).strip().upper()
    candidate_id = int(body.get("candidateId") or 0)
    answers = body.get("answers") or {}
    if exam_id:
        row = db().execute("SELECT * FROM exams WHERE id=?", (exam_id,)).fetchone()
    else:
        row = db().execute("SELECT * FROM exams WHERE UPPER(online_code)=? ORDER BY id DESC", (code,)).fetchone()
        exam_id = row["id"] if row else 0
    if not row or not row["online_code"] or (row["online_code"] or "").upper() != code:
        return jsonify({"error": "答题码不正确或未开启在线作答"}), 403
    if row["status"] != "进行中":
        return jsonify({"error": "该考试已结束作答"}), 403
    cand = db().execute(
        "SELECT name FROM exam_candidates WHERE id=? AND exam_id=?", (candidate_id, exam_id)
    ).fetchone()
    if not cand:
        return jsonify({"error": "考生不存在"}), 404
    items = db().execute(
        "SELECT pi.question_id AS qid, pi.score, q.qtype, q.answer FROM paper_items pi"
        " JOIN questions q ON q.id=pi.question_id WHERE pi.paper_id=?",
        (row["paper_id"],),
    ).fetchall()
    conn = db()
    now = datetime.now().isoformat(timespec="seconds")
    objective, detail = 0.0, []
    subjective = 0
    # 整份覆盖：清除该生本次考试的全部成绩与作答后重写
    conn.execute("DELETE FROM exam_scores WHERE exam_id=? AND candidate_id=?", (exam_id, candidate_id))
    conn.execute("DELETE FROM exam_answers WHERE exam_id=? AND candidate_id=?", (exam_id, candidate_id))
    for it in items:
        ans = answers.get(str(it["qid"]), answers.get(it["qid"]))
        if it["qtype"] in ("单选题", "多选题", "判断题"):
            got, full = objective_verdict(it, ans)
            conn.execute(
                "INSERT INTO exam_scores(exam_id,candidate_id,question_id,score) VALUES(?,?,?,?)",
                (exam_id, candidate_id, it["qid"], got),
            )
            objective += got
            detail.append({"questionId": it["qid"], "got": got, "full": round(float(full), 1)})
        else:
            text = str(ans if ans is not None else "").strip()
            if text:
                conn.execute(
                    "INSERT INTO exam_answers(exam_id,candidate_id,question_id,answer_text,updated_at) VALUES(?,?,?,?,?)",
                    (exam_id, candidate_id, it["qid"], text[:5000], now),
                )
                subjective += 1
    log_action({"name": cand["name"]}, "在线交卷", row["name"],
               f"{cand['name']}：客观题 {round(objective, 1)} 分，主观题 {subjective} 题待批阅")
    conn.commit()
    return jsonify({
        "objectiveScore": round(objective, 1),
        "detail": detail,
        "subjectiveCount": subjective,
        "message": "交卷成功：客观题已自动判分" + ("，主观题待老师批阅" if subjective else ""),
    })


@app.post("/api/exams/<int:eid>/candidates/<int:cid>/sheet")
def upload_answer_sheet(eid, cid):
    """上传某考生的答题卡照片（判分对照用）。"""
    user, err = require_role("teacher")
    if err:
        return err
    cand = db().execute(
        "SELECT name FROM exam_candidates WHERE id=? AND exam_id=?", (cid, eid)
    ).fetchone()
    if not cand:
        return jsonify({"error": "考生不存在"}), 404
    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify({"error": "请选择照片"}), 400
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in UPLOAD_EXTS:
        return jsonify({"error": "仅支持图片格式"}), 400
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    fname = datetime.now().strftime("%Y%m%d%H%M%S") + "_" + secrets.token_hex(4) + ext
    file.save(os.path.join(UPLOAD_DIR, fname))
    db().execute("UPDATE exam_candidates SET answer_sheet_path=? WHERE id=?", (f"backend/uploads/{fname}", cid))
    log_action(user, "上传答题卡", cand["name"], fname)
    db().commit()
    return jsonify({"path": f"backend/uploads/{fname}"})


# ---------------- 考试成绩导出 ----------------

@app.get("/api/exams/<int:eid>/export.xlsx")
def export_exam_scores(eid):
    user, err = require_role("teacher")
    if err:
        return err
    row = db().execute("SELECT * FROM exams WHERE id=?", (eid,)).fetchone()
    if not row:
        return jsonify({"error": "考试不存在"}), 404
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    report = build_exam_report(eid)
    wb = Workbook()
    ws = wb.active
    ws.title = "成绩单"
    header_fill = PatternFill("solid", fgColor="12233A")
    header_font = Font(name="微软雅黑", size=10, bold=True, color="FFFFFF")
    body_font = Font(name="微软雅黑", size=10)
    thin = Side(style="thin", color="D9D2C0")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    ws.append(["名次", "姓名", "班级", "总分", "满分", "得分率(%)", "录分进度"] +
              [f"第{q['position']}题({q['fullScore']}分)" for q in report["perQuestion"]])
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.border = border
        cell.alignment = Alignment(horizontal="center", vertical="center")
    cand_class = {c["id"]: (c["class_name"] or "") for c in db().execute(
        "SELECT id, class_name FROM exam_candidates WHERE exam_id=?", (eid,)).fetchall()}
    for rank, t in enumerate(report["totals"], start=1):
        rate = round(t["total"] / report["fullTotal"] * 100, 1) if report["fullTotal"] else 0
        ws.append([
            rank, t["name"], cand_class.get(t["candidateId"], ""),
            t["total"], report["fullTotal"], rate,
            f"{t['entered']}/{t['questionCount']}",
        ] + [score_lookup(eid, t["candidateId"], q["questionId"]) for q in report["perQuestion"]])
    widths = [6, 10, 12, 8, 8, 10, 10] + [12] * len(report["perQuestion"])
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[chr(64 + i) if i <= 26 else "A" + chr(64 + i - 26)].width = w
    for r_ in ws.iter_rows(min_row=2):
        for cell in r_:
            cell.font = body_font
            cell.border = border
            cell.alignment = Alignment(vertical="center", horizontal="center")
    ws.freeze_panes = "D2"

    ws2 = wb.create_sheet("统计摘要")
    for k, v in [
        ("考试", row["name"]), ("满分", report["fullTotal"]), ("考生数", report["candidateCount"]),
        ("平均分", report["avg"]), ("最高分", report["max"]), ("最低分", report["min"]),
        ("中位数", report["median"]), ("及格线", report["passLine"]), ("及格率(%)", report["passRate"]),
    ]:
        ws2.append([k, v])
    ws2.append([])
    ws2.append(["薄弱知识点", "得分率(%)"])
    for t in report["weakTags"]:
        ws2.append([t["tag"], t["rate"]])
    ws2.column_dimensions["A"].width = 16
    ws2.column_dimensions["B"].width = 12
    for c_ in ws2["A"]:
        c_.font = Font(name="微软雅黑", size=10, bold=True)

    path = os.path.join(BASE_DIR, "export_tmp.xlsx")
    wb.save(path)
    log_action(user, "导出成绩", row["name"], f"{report['candidateCount']} 名考生")
    db().commit()
    return send_file(path, as_attachment=True, download_name=f"{row['name']}_成绩单.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def score_lookup(eid, candidate_id, question_id):
    r = db().execute(
        "SELECT score FROM exam_scores WHERE exam_id=? AND candidate_id=? AND question_id=?",
        (eid, candidate_id, question_id),
    ).fetchone()
    return round(float(r["score"]), 1) if r else None


# 重构：把报告构建提为纯函数（report 接口与导出共用）
def build_exam_report(eid):
    row = db().execute("SELECT * FROM exams WHERE id=?", (eid,)).fetchone()
    if not row:
        return None
    conn = db()
    items = conn.execute(
        "SELECT pi.question_id AS qid, pi.position, pi.score AS full, pi.section, q.qtype, q.tags, q.stem"
        " FROM paper_items pi JOIN questions q ON q.id=pi.question_id"
        " WHERE pi.paper_id=? ORDER BY pi.position, pi.id",
        (row["paper_id"],),
    ).fetchall()
    candidates = conn.execute(
        "SELECT id, name, class_name FROM exam_candidates WHERE exam_id=? ORDER BY id", (eid,)
    ).fetchall()
    score_rows = conn.execute(
        "SELECT candidate_id, question_id, score FROM exam_scores WHERE exam_id=?", (eid,)
    ).fetchall()
    score_map = {(r["candidate_id"], r["question_id"]): float(r["score"] or 0) for r in score_rows}

    totals = []
    for cand in candidates:
        total = sum(score_map.get((cand["id"], it["qid"]), 0.0) for it in items)
        entered = sum(1 for it in items if (cand["id"], it["qid"]) in score_map)
        totals.append({"candidateId": cand["id"], "name": cand["name"], "className": cand["class_name"] or "",
                       "total": round(total, 1), "entered": entered, "questionCount": len(items)})
    values = [t["total"] for t in totals]
    n = len(values)
    values_sorted = sorted(values)
    median = (values_sorted[n // 2] if n % 2 else (values_sorted[n // 2 - 1] + values_sorted[n // 2]) / 2) if n else 0
    full_total = round(sum(float(it["full"] or 0) for it in items), 1)
    avg = round(sum(values) / n, 1) if n else 0
    pass_line = round(full_total * 0.6, 1)
    passed = sum(1 for v in values if v >= pass_line)
    step = 10 if full_total <= 150 else 20
    distribution = []
    for i in range(int(full_total // step) + 1):
        lo, hi = i * step, (i + 1) * step
        label = f"{lo}-{hi}" if hi < full_total else f"{lo}-{int(full_total)}+"
        distribution.append({
            "label": label,
            "count": sum(1 for v in values if lo <= v < hi or (hi >= full_total and v >= lo)),
        })
    per_question = []
    for it in items:
        entered_n = sum(1 for c in candidates if (c["id"], it["qid"]) in score_map)
        got = sum(score_map.get((c["id"], it["qid"]), 0.0) for c in candidates)
        full = float(it["full"] or 0)
        rate = round(got / (full * entered_n) * 100, 1) if entered_n and full > 0 else None
        per_question.append({
            "questionId": it["qid"], "position": it["position"] + 1, "section": it["section"] or it["qtype"],
            "qtype": it["qtype"], "fullScore": round(full, 1), "rate": rate, "entered": entered_n,
            "tags": it["tags"] or "", "stem": it["stem"][:40],
        })
    tag_acc = {}
    for it in items:
        full = float(it["full"] or 0)
        entered_n = sum(1 for c in candidates if (c["id"], it["qid"]) in score_map)
        if not entered_n or full <= 0:
            continue
        got = sum(score_map.get((c["id"], it["qid"]), 0.0) for c in candidates)
        rate = got / (full * entered_n)
        for t in (it["tags"] or "").replace("，", "、").split("、"):
            t = t.strip()
            if not t:
                continue
            acc = tag_acc.setdefault(t, {"got": 0.0, "full": 0.0})
            acc["got"] += got
            acc["full"] += full * entered_n
    weak_tags = sorted(
        ({"tag": t, "rate": round(v["got"] / v["full"] * 100, 1), "full": round(v["full"], 1)}
         for t, v in tag_acc.items() if v["full"] > 0),
        key=lambda x: x["rate"],
    )
    worst = sorted([q for q in per_question if q["rate"] is not None], key=lambda q: q["rate"])[:3]
    entered_all = sum(t["entered"] for t in totals)
    return {
        "exam": exam_meta_to_dict(row),
        "fullTotal": full_total,
        "candidateCount": len(candidates),
        "enteredProgress": {"cells": entered_all, "total": len(candidates) * len(items)},
        "avg": avg, "max": max(values) if values else 0, "min": min(values) if values else 0,
        "median": round(median, 1), "passLine": pass_line,
        "passRate": round(passed / n * 100, 1) if n else 0,
        "distribution": distribution,
        "perQuestion": per_question,
        "weakTags": weak_tags[:8],
        "totals": sorted(totals, key=lambda t: -t["total"]),
        "reviewAdvice": [
            {"position": q["position"], "section": q["section"], "rate": q["rate"], "stem": q["stem"]}
            for q in worst
        ],
    }


@app.get("/api/exams/<int:eid>/report")
def exam_report(eid):
    user, err = require_role()
    if err:
        return err
    report = build_exam_report(eid)
    if report is None:
        return jsonify({"error": "考试不存在"}), 404
    return jsonify(report)


# ---------------- 真题库（exam_papers）与知识点刷题 ----------------

def exam_paper_to_dict(row):
    keys = row.keys()
    return {
        "id": row["id"],
        "examBoard": row["exam_board"] or "Edexcel",
        "qualification": row["qualification"] or "IAL",
        "subject": row["subject"] or "Mathematics",
        "paperName": row["paper_name"],
        "paperCode": row["paper_code"] or "",
        "year": int(row["year"]),
        "session": row["session"] or "",
        "qpUrl": row["qp_url"] or "",
        "msUrl": row["ms_url"] or "",
        "resourceType": row["resource_type"] or "owned_content",
        "status": row["status"],
        "questionCount": db().execute(
            "SELECT COUNT(*) AS n FROM questions WHERE exam_paper_id=? AND deleted_at IS NULL", (row["id"],)
        ).fetchone()["n"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


@app.get("/api/exam-papers")
def list_exam_papers():
    user, err = require_role()
    if err:
        return err
    conds, params = ["1=1"], []
    if user["role"] == "student":
        conds.append("status='published'")
    else:
        status = request.args.get("status", "").strip()
        if status and status != "全部状态":
            conds.append("status=?")
            params.append(status)
    paper = request.args.get("paper", "").strip()
    year = request.args.get("year", "").strip()
    session_ = request.args.get("session", "").strip()
    if paper and paper != "全部":
        conds.append("paper_name=?")
        params.append(paper)
    if year:
        conds.append("year=?")
        params.append(int(year))
    if session_ and session_ != "全部":
        conds.append("session=?")
        params.append(session_)
    rows = db().execute(
        "SELECT * FROM exam_papers WHERE " + " AND ".join(conds) + " ORDER BY year DESC, session DESC, id",
        params,
    ).fetchall()
    return jsonify({"examPapers": [exam_paper_to_dict(r) for r in rows]})


@app.post("/api/exam-papers")
def create_exam_paper():
    user, err = require_role("teacher")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    paper_name = str(body.get("paperName", "")).strip()
    year = int(body.get("year") or 0)
    if paper_name not in ("P1", "P2"):
        return jsonify({"error": "paperName 须为 P1 或 P2"}), 400
    if not year:
        return jsonify({"error": "请填写年份"}), 400
    now = datetime.now().isoformat(timespec="seconds")
    conn = db()
    conn.execute(
        "INSERT INTO exam_papers(exam_board,qualification,subject,paper_name,paper_code,year,session,qp_url,ms_url,resource_type,status,created_by,created_at,updated_at)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (str(body.get("examBoard", "Edexcel")).strip() or "Edexcel",
         str(body.get("qualification", "IAL")).strip() or "IAL",
         str(body.get("subject", "Mathematics")).strip() or "Mathematics",
         paper_name, str(body.get("paperCode", "")).strip(), year,
         str(body.get("session", "")).strip(), str(body.get("qpUrl", "")).strip(),
         str(body.get("msUrl", "")).strip(), str(body.get("resourceType", "owned_content")).strip(),
         body.get("status", "published") if body.get("status") in ("draft", "published", "disabled") else "published",
         user["account"], now, now),
    )
    epid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    log_action(user, "新建真题卷", paper_name, str(year))
    conn.commit()
    row = conn.execute("SELECT * FROM exam_papers WHERE id=?", (epid,)).fetchone()
    return jsonify({"examPaper": exam_paper_to_dict(row)})


@app.put("/api/exam-papers/<int:epid>")
def update_exam_paper(epid):
    user, err = require_role("teacher")
    if err:
        return err
    row = db().execute("SELECT * FROM exam_papers WHERE id=?", (epid,)).fetchone()
    if not row:
        return jsonify({"error": "真题卷不存在"}), 404
    body = request.get_json(silent=True) or {}
    now = datetime.now().isoformat(timespec="seconds")
    status = body.get("status", row["status"])
    if status not in ("draft", "published", "disabled"):
        status = row["status"]
    db().execute(
        "UPDATE exam_papers SET paper_code=?, qp_url=?, ms_url=?, resource_type=?, status=?, updated_at=? WHERE id=?",
        (str(body.get("paperCode", row["paper_code"])).strip(),
         str(body.get("qpUrl", row["qp_url"])).strip(),
         str(body.get("msUrl", row["ms_url"])).strip(),
         str(body.get("resourceType", row["resource_type"])).strip(),
         status, now, epid),
    )
    log_action(user, "编辑真题卷", row["paper_name"], str(row["year"]))
    db().commit()
    fresh = db().execute("SELECT * FROM exam_papers WHERE id=?", (epid,)).fetchone()
    return jsonify({"examPaper": exam_paper_to_dict(fresh)})


@app.delete("/api/exam-papers/<int:epid>")
def delete_exam_paper(epid):
    user, err = require_role("teacher")
    if err:
        return err
    row = db().execute("SELECT * FROM exam_papers WHERE id=?", (epid,)).fetchone()
    if not row:
        return jsonify({"error": "真题卷不存在"}), 404
    conn = db()
    conn.execute("UPDATE questions SET exam_paper_id=NULL WHERE exam_paper_id=?", (epid,))
    conn.execute("DELETE FROM exam_papers WHERE id=?", (epid,))
    log_action(user, "删除真题卷", row["paper_name"], str(row["year"]))
    conn.commit()
    return jsonify({"ok": True})


@app.get("/api/exam-topics")
def exam_topics():
    """按真题卷维度返回 Topic/Subtopic 树（含已发布题量）。"""
    user, err = require_role()
    if err:
        return err
    paper = request.args.get("paper", "P1").strip()
    rows = db().execute(
        "SELECT * FROM knowledge_nodes WHERE paper_scope=? AND status='启用' ORDER BY sort_order, id",
        (paper,),
    ).fetchall()
    parents = [r for r in rows if not r["parent_id"]]

    def count(rid, child_ids):
        ids = [rid] + child_ids
        ph = ",".join("?" * len(ids))
        return db().execute(
            "SELECT COUNT(*) AS n FROM questions WHERE topic_id IN (%s) AND deleted_at IS NULL AND status='启用'" % ph,
            ids,
        ).fetchone()["n"]

    tree = []
    for p in parents:
        children = [r for r in rows if r["parent_id"] == p["id"]]
        child_ids = [ch["id"] for ch in children]
        tree.append({
            "id": p["id"], "name": p["name"], "count": count(p["id"], child_ids),
            "children": [{"id": ch["id"], "name": ch["name"], "count": count(ch["id"], [])} for ch in children],
        })
    return jsonify({"paper": paper, "topics": tree})


# ---------------- 收藏（favorites） ----------------

@app.get("/api/favorites")
def list_favorites():
    user, err = require_role()
    if err:
        return err
    rows = db().execute(
        "SELECT q.* FROM favorites f JOIN questions q ON q.id=f.question_id"
        " WHERE f.user_id=? AND q.deleted_at IS NULL ORDER BY f.id DESC",
        (user["account"],),
    ).fetchall()
    qs = [question_to_dict(r, with_used=True) for r in rows]
    annotate_favorites(user["account"], qs)
    return jsonify({"questions": qs})


@app.post("/api/favorites")
def add_favorite():
    user, err = require_role()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    qid = int(body.get("questionId") or 0)
    if not db().execute("SELECT 1 FROM questions WHERE id=? AND deleted_at IS NULL", (qid,)).fetchone():
        return jsonify({"error": "题目不存在"}), 404
    db().execute(
        "INSERT OR IGNORE INTO favorites(user_id, question_id, created_at) VALUES(?,?,?)",
        (user["account"], qid, datetime.now().isoformat(timespec="seconds")),
    )
    db().commit()
    return jsonify({"ok": True, "favorite": True})


@app.delete("/api/favorites/<int:qid>")
def remove_favorite(qid):
    user, err = require_role()
    if err:
        return err
    db().execute("DELETE FROM favorites WHERE user_id=? AND question_id=?", (user["account"], qid))
    db().commit()
    return jsonify({"ok": True, "favorite": False})


# ---------------- PDF 生成记录（generated_files） ----------------

@app.post("/api/generated-files")
def record_generated():
    user, err = require_role("teacher")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    upid = int(body.get("userPaperId") or 0)
    if not db().execute("SELECT 1 FROM papers WHERE id=?", (upid,)).fetchone():
        return jsonify({"error": "试卷不存在"}), 404
    kind = body.get("kind") if body.get("kind") in ("qp", "ms") else "qp"
    db().execute(
        "INSERT INTO generated_files(user_paper_id, kind, url, status, created_by, created_at) VALUES(?,?,?,?,?,?)",
        (upid, kind, str(body.get("url", "")).strip(), "success", user["account"],
         datetime.now().isoformat(timespec="seconds")),
    )
    db().commit()
    return jsonify({"ok": True})


@app.get("/api/generated-files")
def list_generated():
    user, err = require_role()
    if err:
        return err
    upid = int(request.args.get("userPaperId") or 0)
    base = ("SELECT g.*, p.name AS paper_name FROM generated_files g"
            " JOIN papers p ON p.id=g.user_paper_id")
    if upid:
        rows = db().execute(base + " WHERE g.user_paper_id=? ORDER BY g.id DESC LIMIT 50", (upid,)).fetchall()
    else:
        rows = db().execute(base + " ORDER BY g.id DESC LIMIT 50").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["paperName"] = r["paper_name"]
        out.append(d)
    return jsonify({"files": out})


# ---------------- 审计 ----------------

@app.get("/api/audit")
def audit_query():
    user, err = require_role()
    if err:
        return err
    action = request.args.get("action", "").strip()
    limit = min(int(request.args.get("limit", 150) or 150), 500)
    if action and action != "全部":
        rows = db().execute(
            "SELECT * FROM audit_log WHERE action=? ORDER BY id DESC LIMIT ?", (action, limit)
        ).fetchall()
    else:
        rows = db().execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return jsonify({"logs": [dict(r) for r in rows]})


if __name__ == "__main__":
    init_db()
    print("成都智慧象留学 · 国际课程组卷系统 后端已启动")
    print("访问 http://localhost:8687   （数据文件：backend/zujuan.db，删除即重置）")
    print("提示：学生进度追踪系统运行在 8686 端口，两套系统可同时开启。")
    app.run(host="0.0.0.0", port=8687, threaded=True)
