# -*- coding: utf-8 -*-
"""组卷核心后端完成度核对：生成算法/存卷/蓝图/平行卷/Excel 全链路逐项验证"""
import json, urllib.request, urllib.parse

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
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}

results = []
def check(name, cond, extra=""):
    results.append((name, cond, extra))

s, d = call("POST", "/api/auth/login", {"account": "teacher", "password": "zx123456"})
tok = d["token"]

# ---- 1 智能生成：四种参数形态 ----
# 1a 基础：题型数量+分值
s, d = call("POST", "/api/papers/generate",
            {"subjects": ["雅思阅读"], "types": [{"qtype": "判断题", "count": 3, "score": 2},
                                                  {"qtype": "单选题", "count": 2, "score": 3}]}, token=tok)
check("生成·题型数量", s == 200 and len(d["questions"]) == 5 and d["questions"][0]["assignScore"] in (2, 3))

# 1b 难度分带：全冲刺（4-5）
s, d = call("POST", "/api/papers/generate",
            {"subjects": ["A-Level 数学"], "types": [{"qtype": "单选题", "count": 3, "score": 3}],
             "dist": {"basic": 0, "boost": 0, "sprint": 100}}, token=tok)
bands = [q["difficulty"] for q in d["questions"]]
# 设计口径：冲刺层不足时回补（A-Level 数学单选仅 1 道难题），补齐数量并在 distNote 说明偏离
check("生成·难度分带(不足回补+提示)", s == 200 and len(d["questions"]) == 3 and d.get("distNote"),
      "bands=%s note=%s" % (bands, (d.get("distNote") or "")[:40]))

# 1c 知识点过滤
s, d = call("POST", "/api/papers/generate",
            {"subjects": ["A-Level 数学"], "types": [{"qtype": "简答题", "count": 5, "score": 5}],
             "tags": ["积分"]}, token=tok)
# 设计口径：知识点命中不足 5 题时放宽到全范围并报缺口
has_shortage = len(d.get("shortage", [])) >= 1
check("生成·知识点过滤(不足放宽+缺口)", s == 200 and len(d["questions"]) >= 1 and has_shortage,
      "got=%d shortage=%s" % (len(d.get("questions", [])), [(x["got"], x["requested"]) for x in d.get("shortage", [])]))

# 1d 排除（平行卷）+ 缺口
s, first = call("POST", "/api/papers/generate",
                {"subjects": ["A-Level 数学"], "types": [{"qtype": "单选题", "count": 3, "score": 3}]}, token=tok)
ids1 = [q["id"] for q in first["questions"]]
s, second = call("POST", "/api/papers/generate",
                 {"subjects": ["A-Level 数学"], "types": [{"qtype": "单选题", "count": 3, "score": 3}],
                  "excludeIds": ids1}, token=tok)
ids2 = [q["id"] for q in second["questions"]]
check("生成·排除已用题(平行卷)", s == 200 and not (set(ids1) & set(ids2)), "B卷=%d题" % len(ids2))
check("生成·缺口提示", len(second.get("shortage", [])) >= 1, str([(x["qtype"], x["got"], x["requested"]) for x in second.get("shortage", [])]))

# 1e 多科目范围 + 校验错误
s, d = call("POST", "/api/papers/generate",
            {"subjects": ["雅思听力", "雅思阅读"], "types": [{"qtype": "填空题", "count": 4, "score": 2}]}, token=tok)
check("生成·多科目合并", s == 200 and len(d["questions"]) >= 3)
s, d = call("POST", "/api/papers/generate", {"types": []}, token=tok)
check("生成·空题型400", s == 400)
# 重新生成用于存卷（1e 的 d 覆盖过）
s, d = call("POST", "/api/papers/generate",
            {"subjects": ["雅思听力", "雅思阅读"], "types": [{"qtype": "填空题", "count": 4, "score": 2}]}, token=tok)

# ---- 2 存卷/编辑/复制/定稿/删除 ----
items = [{"questionId": q["id"], "score": q["assignScore"]} for q in d["questions"]]
s, p1 = call("POST", "/api/papers", {"name": "核对卷A", "subjectLine": "核对", "duration": 30,
                                      "variant": "A卷", "items": items}, token=tok)
check("存卷", s == 200 and p1["paper"]["questionCount"] == len(items) and p1["paper"]["variant"] == "A卷")
pid = p1["paper"]["id"]
s, p2 = call("PUT", "/api/papers/%d" % pid, {"name": "核对卷A-v2", "items": items[:-1]}, token=tok)
check("编辑存卷", s == 200 and p2["paper"]["questionCount"] == len(items) - 1 and p2["paper"]["name"] == "核对卷A-v2")
s, p3 = call("POST", "/api/papers/%d/duplicate" % pid, token=tok)
check("复制试卷", s == 200 and p3["paper"]["questionCount"] == p2["paper"]["questionCount"])
s, p4 = call("PUT", "/api/papers/%d/status" % pid, {"status": "定稿"}, token=tok)
check("定稿", s == 200 and p4["paper"]["status"] == "定稿")
s, d = call("GET", "/api/papers", token=tok)
check("试卷列表含元信息", s == 200 and any(p["id"] == pid and p["totalScore"] > 0 for p in d["papers"]))
s, d = call("GET", "/api/papers/%d" % pid, token=tok)
check("试卷详情含题目全量", s == 200 and all("answer" in it["question"] for it in d["paper"]["items"]))
call("DELETE", "/api/papers/%d" % p3["paper"]["id"], token=tok)
s, d = call("GET", "/api/papers/%d" % p3["paper"]["id"], token=tok)
check("删除后404", s == 404)

# ---- 3 蓝图（组卷配置存复） ----
s, d = call("GET", "/api/blueprints", token=tok)
check("蓝图·种子自带", s == 200 and len(d["blueprints"]) >= 1 and d["blueprints"][0]["config"]["types"])
s, d = call("POST", "/api/blueprints", {"name": "核对蓝图", "config": {"name": "x", "types": [{"qtype": "单选题", "count": 2, "score": 2}], "dist": {"basic": 50, "boost": 50, "sprint": 0}, "subjects": [], "tags": [], "duration": 20}}, token=tok)
check("蓝图·保存", s == 200)
s, d = call("GET", "/api/blueprints", token=tok)
bid = [b for b in d["blueprints"] if b["name"] == "核对蓝图"][0]["id"]
s, d = call("DELETE", "/api/blueprints/%d" % bid, token=tok)
check("蓝图·删除", s == 200)

# ---- 4 组卷联动：题目入卷次数 / 删题联动 ----
s, d = call("GET", "/api/questions?q=Does%20the%20tutor%20suggest", token=tok)
qid = d["questions"][0]["id"]
used0 = d["questions"][0]["usedCount"]
s, d = call("POST", "/api/papers", {"name": "联动核对卷", "items": [{"questionId": qid, "score": 3}]}, token=tok)
link_pid = d["paper"]["id"]
s, d = call("GET", "/api/questions?q=Does%20the%20tutor%20suggest", token=tok)
check("入卷次数+1", d["questions"][0]["usedCount"] == used0 + 1)
s, d = call("DELETE", "/api/questions/%d" % qid, token=tok)
check("删题联动移出试卷", s == 200 and d.get("removedFromPapers", 0) >= 1, "removed=%s" % d.get("removedFromPapers"))
s, d = call("GET", "/api/papers/%d" % link_pid, token=tok)
check("试卷中该题已移除", s == 200 and all(it["question"]["id"] != qid for it in d["paper"]["items"]))
call("DELETE", "/api/papers/%d" % link_pid, token=tok)
call("POST", "/api/questions/%d/restore" % qid, token=tok)

# ---- 5 Excel（题库侧组卷配套） ----
s, data = call("GET", "/api/questions/export", token=tok, raw=True)
check("题库导出xlsx", s == 200 and data[:2] == b"PK")
s, data = call("GET", "/api/questions/template", token=tok, raw=True)
check("导入模板xlsx", s == 200 and data[:2] == b"PK")

passed = sum(1 for _, ok, _ in results if ok)
for name, ok, extra in results:
    print(("PASS" if ok else "FAIL"), name, ("| " + str(extra)) if extra else "")
print("---")
print("%d/%d passed" % (passed, len(results)))
