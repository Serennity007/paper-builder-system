# -*- coding: utf-8 -*-
"""v3 增量冒烟：在线答题/知识树/相似查重/成绩导出/共享权限"""
import json, io, urllib.request, urllib.parse

BASE = "http://localhost:8687"

def call(method, path, body=None, token=None, raw=False, as_teacher=None):
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

s, t1 = call("POST", "/api/auth/login", {"account": "teacher", "password": "zx123456"})
tok = t1["token"]
s, t2 = call("POST", "/api/auth/login", {"account": "wangli", "password": "zx123456"})
tok2 = t2["token"]

# 1 相似查重（近似串）
s, d = call("POST", "/api/questions/check-dup",
            {"stem": "What is the writer's main point in this paragraph?? pls"}, token=tok)
check("相似查重(近似)", s == 200 and len(d["duplicates"]) >= 1 and d["duplicates"][0]["similarity"] >= 80,
      str([(x["similarity"]) for x in d.get("duplicates", [])]))

# 2 知识树（种子预置知识点，验证非空 + 增删闭环）
s, d = call("GET", "/api/knowledge", token=tok)
check("知识树预置非空", s == 200 and len(d["tree"]) >= 3 and all(t["nodes"] for t in d["tree"]),
      "subjects=%d" % len(d.get("tree", [])))
s, d = call("POST", "/api/knowledge", {"subject": "雅思阅读", "name": "冒烟父节点"}, token=tok)
check("建父节点", s == 200, str(d)[:60])
tree = d["tree"]
pnode = [t for t in tree if t["subject"] == "雅思阅读"][0]
pid = [n for n in pnode["nodes"] if n["name"] == "冒烟父节点"][0]["id"]
s, d = call("POST", "/api/knowledge", {"subject": "雅思阅读", "name": "冒烟子节点", "parentId": pid}, token=tok)
read_tree = [t for t in d["tree"] if t["subject"] == "雅思阅读"][0]
kids = [n for n in read_tree["nodes"] if n["name"] == "冒烟父节点"][0]["children"]
check("建子节点", s == 200 and any(k["name"] == "冒烟子节点" for k in kids), str(kids)[:60])
s, d = call("DELETE", "/api/knowledge/%d" % pid, token=tok)
check("删父连带子", s == 200 and not any(n["name"] == "冒烟父节点" for t in d["tree"] if t["subject"] == "雅思阅读" for n in t["nodes"]))

# 3 共享/私有权限（wangli 建私有题 → admin 可见可改；admin 建私有题 → wangli 不可见不可改）
s, d = call("POST", "/api/questions", {"subject": "A-Level 数学", "qtype": "单选题", "stem": "wangli私有题 1+1=?",
                                        "options": ["A. 2", "B. 3"], "answer": "A", "isPublic": False}, token=tok2)
pid_q = d["question"]["id"]
check("wangli 建私有题", s == 200 and d["question"]["isPublic"] is False)
s, d = call("GET", "/api/questions?q=wangli私有题", token=tok)
check("admin 可见他人私有题", len(d["questions"]) >= 1, "n=%d" % len(d["questions"]))
s, d = call("GET", "/api/questions?q=wangli私有题", token=tok2)
check("创建者可见私有题", len(d["questions"]) >= 1)
s, d = call("POST", "/api/questions", {"subject": "A-Level 物理", "qtype": "单选题", "stem": "admin私有题 F=ma",
                                        "options": ["A. 对", "B. 错"], "answer": "A", "isPublic": False}, token=tok)
admin_q = d["question"]["id"]
s, d = call("GET", "/api/questions?q=admin私有题", token=tok2)
check("wangli 看不到 admin 私有题", len(d["questions"]) == 0, "n=%d" % len(d["questions"]))
s, d = call("PUT", "/api/questions/%d" % admin_q, {"difficulty": 2}, token=tok2)
check("wangli 编辑他人私有题403", s == 403)
s, d = call("PUT", "/api/questions/%d" % admin_q, {"difficulty": 4}, token=tok)
check("admin 可编辑私有题", s == 200 and d["question"]["difficulty"] == 4)

# 4 在线答题全流程（种子考试无 onlineCode，创建一场）
s, d = call("POST", "/api/exams", {"name": "在线冒烟考试", "paperId": 1, "online": True,
                                    "candidates": [{"name": "陈思远", "className": "国际课1对1"}]}, token=tok)
check("创建在线考试", s == 200 and len(d["exam"]["onlineCode"]) == 6, d.get("exam", {}).get("onlineCode", ""))
eid = d["exam"]["id"]
code = d["exam"]["onlineCode"]
# verify 错码
s, d = call("POST", "/api/online/verify", {"examId": eid, "code": "XXXXXX", "name": "陈思远"})
check("答题码错误403", s == 403)
# verify 正确
s, d = call("POST", "/api/online/verify", {"examId": eid, "code": code, "name": "陈思远"})
check("进入答题", s == 200 and len(d["questions"]) == 6 and d["candidateId"], "q=%d" % len(d.get("questions", [])))
check("学生卷无答案", all("answer" not in q for q in d["questions"]))
qs = d["questions"]
cid = d["candidateId"]
# 交卷：1 对 2 错 3 多选漏选 4 填空文本 5 空
answers = {}
for i, q in enumerate(qs):
    if q["qtype"] == "判断题":
        answers[str(q["questionId"])] = "对" if i == 0 else "错"
    elif q["qtype"] == "单选题":
        answers[str(q["questionId"])] = "A"
    elif q["qtype"] == "多选题":
        answers[str(q["questionId"])] = "A"
    elif q["qtype"] == "填空题":
        answers[str(q["questionId"])] = "algae"
s, d = call("POST", "/api/online/submit", {"examId": eid, "code": code, "candidateId": cid, "answers": answers})
check("在线交卷", s == 200 and d["objectiveScore"] >= 0, str(d.get("objectiveScore")))
# 核对判分规则：取详情对照
s, d = call("GET", "/api/exams/%d" % eid, token=tok)
ex = d["exam"]
truth = {it["questionId"]: it for it in ex["items"]}
ok_scores = True
sum_obj = 0.0
for sc in ex["scores"]:
    full = truth[sc["questionId"]]["fullScore"]
    sum_obj += sc["score"]
    if sc["score"] > full:
        ok_scores = False
check("客观分写入且不超满分", ok_scores, "sum=%s" % round(sum_obj, 1))
check("主观题答案已存", len(ex["answers"]) >= 1 and ex["answers"][0]["answerText"] == "algae",
      str(ex.get("answers"))[:50])
# 教师批阅主观题：直接打分
sub_qid = ex["answers"][0]["questionId"]
sub_full = truth[sub_qid]["fullScore"]
s, d = call("PUT", "/api/exams/%d/scores" % eid, {"candidateId": cid, "scores": {str(sub_qid): sub_full}}, token=tok)
check("批阅主观题", s == 200 and d["enteredCount"] >= 1, str(d))
# 成绩导出
s, data = call("GET", "/api/exams/%d/export.xlsx" % eid, token=tok, raw=True)
check("成绩单xlsx", s == 200 and data[:2] == b"PK", "bytes=%d" % len(data))
call("DELETE", "/api/exams/%d" % eid, token=tok)
call("DELETE", "/api/questions/%d/purge" % pid_q, token=tok)
call("DELETE", "/api/questions/%d/purge" % admin_q, token=tok)
# 清理历史残留私有题
s, d = call("GET", "/api/questions?q=私有题", token=tok)
for q in d["questions"]:
    call("DELETE", "/api/questions/%d" % q["id"], token=tok)
    call("DELETE", "/api/questions/%d/purge" % q["id"], token=tok)

passed = sum(1 for _, ok, _ in results if ok)
for name, ok, extra in results:
    print(("PASS" if ok else "FAIL"), name, ("| " + str(extra)) if extra else "")
print("---")
print("%d/%d passed" % (passed, len(results)))
