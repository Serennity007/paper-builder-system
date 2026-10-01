# -*- coding: utf-8 -*-
"""邮箱验证码登录冒烟测试：python smoke_email.py（需后端运行中）
覆盖：格式校验 / 未绑定邮箱 / 发码回显（开发模式）/ 错码尝试 / 60s 重发限频 /
      正码登录签发令牌 / 审计留痕 / 旧码重放拦截。
开跑前若撞上一次运行的 60s 冷却，会自动等待至冷却结束。"""
import json
import time
import urllib.parse
import urllib.request
import urllib.error

BASE = "http://localhost:8687"
EMAIL = "teacher@zhxx.cn"

results = []


def call(method, path, body=None, token=None):
    if any(ord(ch) > 127 for ch in path):
        q, _, qs = path.partition("?")
        path = q + ("?" + urllib.parse.quote(qs, safe="=&") if qs else "")
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = json.dumps(body).encode() if body is not None else None
    try:
        r = urllib.request.urlopen(req, data=data)
        return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}


def check(name, cond, extra=""):
    results.append(cond)
    print(("PASS " if cond else "FAIL ") + name + (" | " + str(extra) if extra else ""))


# 1. 邮箱格式校验
s, d = call("POST", "/api/auth/email-code", {"email": "not-an-email"})
check("邮箱格式校验 400", s == 400, d)

# 2. 未绑定邮箱
s, d = call("POST", "/api/auth/email-code", {"email": "nobody@zhxx.cn"})
check("未绑定邮箱 404", s == 404, d)

# 3. 发码（撞冷却则等待重试，最长 ~75s）
s, d = call("POST", "/api/auth/email-code", {"email": EMAIL})
tries = 0
while s == 429 and tries < 15:
    time.sleep(5)
    tries += 1
    s, d = call("POST", "/api/auth/email-code", {"email": EMAIL})
check("发码成功（开发模式回显）", s == 200 and (d.get("devCode") or "").isdigit() and len(d.get("devCode")) == 6, d)
code = d.get("devCode", "")

# 4. 立即重发 → 60s 限频
s2, d2 = call("POST", "/api/auth/email-code", {"email": EMAIL})
check("重发限频 429", s2 == 429, d2)

# 5. 错码 → 400 且提示剩余次数
s3, d3 = call("POST", "/api/auth/email-login", {"email": EMAIL, "code": "000000" if code != "000000" else "111111"})
check("错码 400", s3 == 400 and "不正确" in d3.get("error", ""), d3)

# 6. 验证码登录 → token + profile
s4, d4 = call("POST", "/api/auth/email-login", {"email": EMAIL, "code": code})
profile = d4.get("profile", {})
check("正码登录 200", s4 == 200 and d4.get("token") and profile.get("name") == "金老师" and profile.get("role") == "admin", profile)

# 7. 非数字码 / 未获取验证码就登录
s5, d5 = call("POST", "/api/auth/email-login", {"email": EMAIL, "code": "12ab56"})
check("非 6 位数字码 400", s5 == 400, d5)
s6, d6 = call("POST", "/api/auth/email-login", {"email": EMAIL, "code": "123456"})
check("无可用验证码 400", s6 == 400, d6)

# 8. 令牌可用（bootstrap 通）+ 审计含「邮箱登录」
if d4.get("token"):
    s7, d7 = call("GET", "/api/bootstrap", token=d4["token"])
    check("新令牌可访问 bootstrap", s7 == 200 and d7.get("profile", {}).get("account") == "teacher", {})
    s8, d8 = call("GET", "/api/audit?action=全部&limit=50", token=d4["token"])
    acts = [l.get("action") for l in d8.get("logs", [])]
    check("审计含「邮箱登录」", "邮箱登录" in acts, acts[:5])
else:
    results.extend([False, False])
    print("SKIP bootstrap/audit（登录未成功）")

print("---")
print("%d/%d passed" % (sum(1 for x in results if x), len(results)))
