# -*- coding: utf-8 -*-
"""新功能接口冒烟测试：python smoke_v2.py（需后端运行中，测试后自动清理）"""
import json, io, struct, zlib, urllib.request, urllib.parse

BASE = "http://localhost:8687"

def call(method, path, body=None, token=None, raw=False):
    if any(ord(ch) > 127 for ch in path):
        q, _, qs = path.partition("?")
        path = q + ("?" + urllib.parse.quote(qs, safe="=&") if qs else "")
    req = urllib.request.Request(BASE + path, method=method)
    if body is not None and not raw:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(body).encode()
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        r = urllib.request.urlopen(req)
        data = r.read()
        return r.status, (data if raw else json.loads(data))
    except urllib.error.HTTPError as e:
        raw_e = e.read()
        try:
            return e.code, json.loads(raw_e or b"{}")
        except Exception:
            return e.code, {"_raw": raw_e[:100].decode("utf-8", "ignore")}

results = []

def check(name, cond, extra=""):
    results.append((name, cond, extra))

s, d = call("POST", "/api/auth/login", {"account": "teacher", "password": "zx123456"})
tok = d.get("token")
check("登录", s == 200)

# 题库新字段
s, d = call("GET", "/api/questions", token=tok)
q0 = d["questions"][0]
check("题库含新字段", all(k in q0 for k in ("starred", "imagePath", "usedCount", "deleted")),
      str({k: q0.get(k) for k in ("starred", "usedCount")}))
used = [q for q in d["questions"] if q["usedCount"] > 0]
check("使用次数统计", len(used) == 13, "used=%d" % len(used))  # 种子三套卷共引用 13 题

# 收藏 + 批量
qid = q0["id"]
s, d = call("POST", "/api/questions/batch", {"ids": [qid], "action": "star"}, token=tok)
s, d = call("GET", "/api/questions?starred=1", token=tok)
check("收藏+筛选", s == 200 and len(d["questions"]) == 1)
s, d = call("POST", "/api/questions/batch", {"ids": [qid], "action": "unstar"}, token=tok)
check("取消收藏", s == 200)

# 查重
s, d = call("POST", "/api/questions/check-dup",
            {"stem": "What is the writer's main point in this paragraph?"}, token=tok)
check("相似题查重", s == 200 and len(d["duplicates"]) >= 1, str(len(d.get("duplicates", []))))

# 回收站
s, d = call("POST", "/api/questions",
            {"subject": "雅思听力", "qtype": "填空题", "stem": "回收站冒烟题 ____", "answer": "x"}, token=tok)
tid = d["question"]["id"]
s, d = call("DELETE", "/api/questions/%d" % tid, token=tok)
check("软删除", s == 200)
s, d = call("GET", "/api/questions/trash", token=tok)
check("回收站列表", s == 200 and any(q["id"] == tid for q in d["questions"]))
s, d = call("GET", "/api/questions", token=tok)
check("列表不含已删", all(q["id"] != tid for q in d["questions"]))
s, d = call("POST", "/api/questions/%d/restore" % tid, token=tok)
check("恢复", s == 200)
s, d = call("DELETE", "/api/questions/%d" % tid, token=tok)
s, d = call("DELETE", "/api/questions/%d/purge" % tid, token=tok)
check("彻底删除", s == 200)

# 上传
def make_png():
    def chunk(t, data):
        c = t + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    ihdr = struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + b"\x12\x34\x56" * 2 for _ in range(2))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

png = make_png()
boundary = "----up1"
body = io.BytesIO()
body.write(("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"t.png\"\r\nContent-Type: image/png\r\n\r\n" % boundary).encode())
body.write(png)
body.write(("\r\n--%s--\r\n" % boundary).encode())
req = urllib.request.Request(BASE + "/api/upload", method="POST")
req.add_header("Authorization", "Bearer " + tok)
req.add_header("Content-Type", "multipart/form-data; boundary=" + boundary)
req.data = body.getvalue()
r = urllib.request.urlopen(req)
up = json.loads(r.read())
check("图片上传", r.status == 200 and up["path"].startswith("backend/uploads/"), up.get("path", ""))
s, data = call("GET", "/" + up["path"], raw=True)
check("图片可访问", s == 200 and data[:4] == b"\x89PNG")

# 配图题目
s, d = call("POST", "/api/questions",
            {"subject": "A-Level 物理", "qtype": "单选题", "stem": "如图所示，求支持力",
             "options": ["A. 10N", "B. 20N"], "answer": "A", "imagePath": up["path"]}, token=tok)
check("配图题保存", s == 200 and d["question"]["imagePath"] == up["path"])
iqid = d["question"]["id"]

# 蓝图
s, d = call("GET", "/api/blueprints", token=tok)
check("蓝图列表(种子)", s == 200 and len(d["blueprints"]) == 1 and d["blueprints"][0]["config"]["types"],
      "n=%d" % len(d.get("blueprints", [])))
seed_bid = d["blueprints"][0]["id"]
s, d = call("POST", "/api/blueprints",
            {"name": "冒烟蓝图", "config": {"name": "x", "types": [{"qtype": "单选题", "count": 1, "score": 1}],
                                            "dist": {"basic": 100, "boost": 0, "sprint": 0}, "subjects": [], "tags": [], "duration": 0}},
            token=tok)
check("保存蓝图", s == 200)
s, d = call("DELETE", "/api/blueprints/%d" % seed_bid, token=tok)
check("删除蓝图", s == 200)
s, d = call("GET", "/api/blueprints", token=tok)
check("删除后剩冒烟蓝图", s == 200 and any(b["name"] == "冒烟蓝图" for b in d["blueprints"]))

# 名单
s, d = call("GET", "/api/roster", token=tok)
check("名单(种子6人)", s == 200 and len(d["students"]) == 6, "n=%d" % len(d.get("students", [])))
s, d = call("POST", "/api/roster", {"students": [{"name": "测试生", "className": "冒烟班"},
                                                  {"name": "测试生", "className": "冒烟班"}]}, token=tok)
check("名单去重添加", s == 200 and d["added"] == 1 and d["skipped"] == 1, str(d))
s, d = call("GET", "/api/roster", token=tok)
rid = [x["id"] for x in d["students"] if x["name"] == "测试生"][0]
s, d = call("DELETE", "/api/roster/%d" % rid, token=tok)
check("删除名单", s == 200)

# 考试：创建 → 详情 → 录分 → 报告
s, d = call("GET", "/api/roster", token=tok)
cands = [{"name": x["name"], "className": x["class_name"]} for x in d["students"][:4]]
s, d = call("POST", "/api/exams", {"name": "冒烟考试", "paperId": 2, "examDate": "2026-09-28", "candidates": cands}, token=tok)
check("创建考试", s == 200 and d["exam"]["candidateCount"] == 4, "cand=%s" % d.get("exam", {}).get("candidateCount"))
eid = d["exam"]["id"]
s, d = call("GET", "/api/exams/%d" % eid, token=tok)
check("考试详情", s == 200 and len(d["exam"]["items"]) == 5 and len(d["exam"]["candidates"]) == 4)
c0 = d["exam"]["candidates"][0]["id"]
items = d["exam"]["items"]
scores = {str(it["questionId"]): it["fullScore"] for it in items}
scores[str(items[0]["questionId"])] = 0.0
s, d = call("PUT", "/api/exams/%d/scores" % eid, {"candidateId": c0, "scores": scores}, token=tok)
check("录分(满分截断)", s == 200 and d["enteredCount"] == 5 and d["totalScore"] == 16.0, str(d))
s, d = call("PUT", "/api/exams/%d/scores" % eid, {"candidateId": c0, "scores": {str(items[0]["questionId"]): None}}, token=tok)
check("清除单格", s == 200 and d["enteredCount"] == 4)
s, d = call("PUT", "/api/exams/%d/scores" % eid, {"candidateId": c0, "scores": {str(items[0]["questionId"]): items[0]["fullScore"]}}, token=tok)
s, d = call("GET", "/api/exams/%d/report" % eid, token=tok)
r = d.get("report", d)
# 4 名考生只录了 1 人满分 → avg=(19+0+0+0)/4=4.8
check("统计报告", s == 200 and r["candidateCount"] == 4 and r["avg"] == 4.8 and r["fullTotal"] == 19.0,
      "avg=%s" % r.get("avg"))
check("报告结构完整", all(k in r for k in ("weakTags", "distribution", "reviewAdvice", "perQuestion", "totals")))
s, d = call("GET", "/api/exams/1/report", token=tok)
r = d.get("report", d)
check("种子考试报告", s == 200 and r["candidateCount"] == 6 and r["fullTotal"] == 15.0,
      "avg=%s pass=%s" % (r.get("avg"), r.get("passRate")))
s, d = call("PUT", "/api/exams/%d" % eid, {"status": "已完结"}, token=tok)
check("考试完结", s == 200 and d["exam"]["status"] == "已完结")
s, d = call("DELETE", "/api/exams/%d" % eid, token=tok)
check("删除考试", s == 200)

# 平行卷排除
s, g1 = call("POST", "/api/papers/generate",
             {"subjects": ["A-Level 数学"], "types": [{"qtype": "单选题", "count": 3, "score": 3}]}, token=tok)
ids1 = [q["id"] for q in g1["questions"]]
s, g2 = call("POST", "/api/papers/generate",
             {"subjects": ["A-Level 数学"], "types": [{"qtype": "单选题", "count": 3, "score": 3}], "excludeIds": ids1}, token=tok)
ids2 = [q["id"] for q in g2["questions"]]
check("平行卷排除已用题", s == 200 and not (set(ids1) & set(ids2)), "A=%s B=%s" % (ids1, ids2))

# 试卷 variant
s, d = call("POST", "/api/papers", {"name": "AB卷测试", "items": [{"questionId": ids1[0], "score": 3}], "variant": "A卷"}, token=tok)
check("A/B卷标记", s == 200 and d["paper"]["variant"] == "A卷")
call("DELETE", "/api/papers/%d" % d["paper"]["id"], token=tok)

# 备份/恢复
s, data = call("GET", "/api/backup", token=tok, raw=True)
bk = json.loads(data)
check("备份导出", s == 200 and len(bk["questions"]) >= 51 and "exam_scores" in bk, "q=%d" % len(bk["questions"]))
s, d = call("POST", "/api/restore", {"data": bk}, token=tok)
check("恢复导入", s == 200)
s, d = call("GET", "/api/questions", token=tok)
check("恢复后数据一致", s == 200 and len(d["questions"]) >= 88, "n=%d" % len(d["questions"]))  # 快照随种子增长

# 清理配图题
call("DELETE", "/api/questions/%d" % iqid, token=tok)
call("DELETE", "/api/questions/%d/purge" % iqid, token=tok)

passed = sum(1 for _, ok, _ in results if ok)
for name, ok, extra in results:
    print(("PASS" if ok else "FAIL"), name, ("| " + str(extra)) if extra else "")
print("---")
print("%d/%d passed" % (passed, len(results)))
