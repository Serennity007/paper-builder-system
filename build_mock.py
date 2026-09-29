# -*- coding: utf-8 -*-
"""从 backend/seed.json 重新生成 js/mock-data.js（演示模式种子）。

用法：改完 backend/seed.json 后，在 06-组卷系统 目录下执行
    python build_mock.py
两种模式（服务端 / 演示）的题目内容即保持一致。
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.join(HERE, "backend", "seed.json")
OUT = os.path.join(HERE, "js", "mock-data.js")

with open(SEED, encoding="utf-8") as f:
    seed = json.load(f)

qmap = {}
for i, q in enumerate(seed["questions"], start=1):
    qmap[(q["stem"], q["subject"])] = i

papers = []
for p in seed.get("papers", []):
    items = []
    for pos, it in enumerate(p.get("items", []), start=1):
        qid = qmap.get((it["stem"], it["subject"]))
        if qid:
            items.append({"itemId": "%d-%d" % (abs(hash(p["name"])) % 10000, pos),
                          "position": pos - 1, "score": it.get("score", 0),
                          "section": "", "questionId": qid})
    papers.append({"id": 9001 + len(papers), "name": p["name"], "subjectLine": p.get("subjectLine", ""),
                   "remark": p.get("remark", ""), "duration": p.get("duration", 0),
                   "status": p.get("status", "草稿"), "variant": p.get("variant", ""),
                   "createdBy": p.get("createdBy", "teacher"),
                   "createdAt": "2026-09-20T10:00:00", "updatedAt": "2026-09-26T15:30:00",
                   "items": items})
# 演示库里的试卷 id 从 1 开始更自然
for i, p in enumerate(papers):
    p["id"] = i + 1
pmap = {p["name"]: p["id"] for p in papers}

questions = []
for i, q in enumerate(seed["questions"], start=1):
    questions.append({
        "id": i, "subject": q["subject"], "qtype": q["qtype"], "difficulty": q.get("difficulty", 3),
        "tags": q.get("tags", ""), "passage": q.get("passage", ""), "stem": q["stem"],
        "options": q.get("options", []), "answer": q.get("answer", ""), "explanation": q.get("explanation", ""),
        "score": q.get("score", 0), "duration": q.get("duration", 0), "source": q.get("source", ""),
        "status": "启用", "starred": 0, "deletedAt": None,
        "imagePath": q.get("imagePath", ""), "audioPath": q.get("audioPath", ""),
        "isPublic": q.get("isPublic", True),
        "createdBy": q.get("createdBy", "teacher"),
        "createdAt": "2026-09-15T09:00:00", "updatedAt": "2026-09-15T09:00:00",
    })

roster = []
for i, s in enumerate(seed.get("roster", []), start=1):
    roster.append({"id": i, "name": s["name"], "className": s.get("className", "")})

blueprints = []
for i, b in enumerate(seed.get("blueprints", []), start=1):
    blueprints.append({"id": i, "name": b["name"], "config": b["config"], "createdAt": "2026-09-22T11:00:00"})

exams = []
for i, e in enumerate(seed.get("exams", []), start=1):
    paper_id = pmap.get(e["paperName"])
    if not paper_id:
        continue
    candidates = []
    scores = []
    for ci, cand in enumerate(e.get("candidates", [])):
        cid = i * 100 + ci
        candidates.append({"id": cid, "name": cand["name"], "className": cand.get("className", "")})
        for stem, subject, score in cand.get("scores", []):
            qid = qmap.get((stem, subject))
            if qid:
                scores.append({"candidateId": cid, "questionId": qid, "score": score})
    exams.append({"id": i, "paperId": paper_id, "name": e["name"], "examDate": e.get("examDate", ""),
                  "remark": e.get("remark", ""), "status": e.get("status", "进行中"),
                  "onlineCode": e.get("onlineCode", ""),
                  "createdBy": e.get("createdBy", "teacher"), "createdAt": "2026-09-25T09:00:00",
                  "candidates": candidates, "scores": scores, "answers": []})

knowledge = []
kid = 0
name_to_id = {}
for node in seed.get("knowledge", []):
    if not node.get("parent"):
        kid += 1
        name_to_id[(node["subject"], node["name"])] = kid
        knowledge.append({"id": kid, "subject": node["subject"], "name": node["name"], "parentId": 0})
for node in seed.get("knowledge", []):
    if node.get("parent"):
        kid += 1
        knowledge.append({"id": kid, "subject": node["subject"], "name": node["name"],
                          "parentId": name_to_id.get((node["subject"], node["parent"]), 0)})

payload = {
    "credentials": [{"account": c["account"], "password": c["password"], "name": c["name"],
                     "title": c.get("title", ""), "role": c["role"]} for c in seed["credentials"]],
    "subjects": seed["subjects"],
    "knowledge": knowledge,
    "questions": questions,
    "papers": papers,
    "roster": roster,
    "blueprints": blueprints,
    "exams": exams,
}

js = """/* =========================================================
 * 成都智慧象留学 - 国际课程组卷系统 · 演示模式种子数据
 * 由 backend/seed.json 自动生成（python build_mock.py，改题请改 seed.json 后重新生成），
 * 演示模式数据存 sessionStorage（键 zhxx_zj_demo_v1），关标签页即重置。
 * ========================================================= */
(function () {
  'use strict';
  window.ZJ_MOCK = %s;
})();
""" % json.dumps(payload, ensure_ascii=False, indent=1)

with open(OUT, "w", encoding="utf-8") as f:
    f.write(js)

print("mock-data.js 已生成：%d 道题、%d 套试卷、%d 人名单、%d 套蓝图、%d 场考试（%d 条成绩）"
      % (len(questions), len(papers), len(roster), len(blueprints), len(exams),
         sum(len(e["scores"]) for e in exams)))
