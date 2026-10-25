"""Production smoke test for account controls (plan F). Prints no secrets.

Env: SMOKE_DIR (holds vercel_bypass.txt and smoke_passwords.json with keys admin, admin2, judge, judge2, lawyer),
SMOKE_RUN (id used in the smoke e-mails; the admin account smoke-admin-<RUN> must already exist).
The step-up bucket allows 5 verified attempts per 15 minutes, so this script uses exactly 5.
"""
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("SMOKE_BASE", "https://peacelaw.vercel.app")
D = os.environ["SMOKE_DIR"]
BYPASS = open(os.path.join(D, "vercel_bypass.txt")).read().strip()
PW = json.load(open(os.path.join(D, "smoke_passwords.json")))
RUN = os.environ["SMOKE_RUN"]
results = []
WRONG = "senha-errada-123456"


def check(name, ok, detail=""):
    ok = bool(ok)
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


class Client:
    def __init__(self):
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        req.add_header("x-vercel-protection-bypass", BYPASS)
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            res = self.opener.open(req, timeout=90)
            status, content = res.status, res.read()
        except urllib.error.HTTPError as e:
            status, content = e.code, e.read()
        try:
            return status, json.loads(content) if content else None
        except ValueError:
            return status, None


def email(key):
    return f"smoke-{key}-{RUN}@peacelaw.test"


def login(key, password=None):
    c = Client()
    s, body = c.call("POST", "/api/auth/login", {"email": email(key), "password": password or PW[key]})
    return c, s, body


admin, s, _ = login("admin")
check("admin login", s == 200, str(s))

# Creating accounts: ADMIN needs the acting admin's password (step-up attempt 1 of 5).
s, body = admin.call("POST", "/api/admin/users", {"email": email("admin2"), "role": "ADMIN", "password": PW["admin2"]})
check("create ADMIN without admin_password -> 422 on that field", s == 422 and body["errors"][0]["field"] == "admin_password", str(s))
s, created_admin2 = admin.call("POST", "/api/admin/users", {"email": email("admin2"), "role": "ADMIN", "password": PW["admin2"], "admin_password": PW["admin"]})
check("create ADMIN with the right admin_password -> 201", s == 201, str(s))
s, judge = admin.call("POST", "/api/admin/users", {"email": email("judge"), "role": "JUDGE", "password": PW["judge"]})
check("create JUDGE needs no step-up", s == 201, str(s))
s, lawyer = admin.call("POST", "/api/admin/users", {"email": email("lawyer"), "role": "LAWYER", "password": PW["lawyer"]})
check("create LAWYER needs no step-up", s == 201, str(s))

# Deactivation of a non-admin (bodyless).
judge_client, s, _ = login("judge")
check("judge logs in", s == 200, str(s))
s, _ = admin.call("POST", f"/api/admin/users/{admin.call('GET', '/api/auth/me')[1]['id']}/deactivate")
check("deactivating yourself -> 409", s == 409, str(s))
s, _ = admin.call("POST", f"/api/admin/users/{judge['id']}/deactivate")
check("deactivate judge (bodyless) -> 204", s == 204, str(s))
s, _ = judge_client.call("GET", "/api/auth/me")
check("deactivated judge's session is dead", s == 401, str(s))
_, s_inactive, body_inactive = login("judge")
_, s_wrong, body_wrong = login("judge", WRONG)
check("inactive+correct password looks like a wrong password", (s_inactive, body_inactive) == (s_wrong, body_wrong) and s_inactive == 401, f"{s_inactive}/{s_wrong}")
s, _ = admin.call("POST", f"/api/admin/users/{judge['id']}/reactivate")
check("reactivate judge -> 204", s == 204, str(s))
old_session_alive = judge_client.call("GET", "/api/auth/me")[0]
check("old session stays dead after reactivation", old_session_alive == 401, str(old_session_alive))
judge_client, s, _ = login("judge")
check("judge can log in again", s == 200, str(s))

# Deactivating / reactivating an ADMIN needs step-up (attempts 2, 3 and 4 of 5).
s, body = admin.call("POST", f"/api/admin/users/{created_admin2['id']}/deactivate")
check("deactivate ADMIN without password -> 422", s == 422 and body["errors"][0]["field"] == "admin_password", str(s))
s, _ = admin.call("POST", f"/api/admin/users/{created_admin2['id']}/deactivate", {"admin_password": WRONG})
check("deactivate ADMIN with a wrong password -> 400", s == 400, str(s))
s, _ = admin.call("POST", f"/api/admin/users/{created_admin2['id']}/deactivate", {"admin_password": PW["admin"]})
check("deactivate ADMIN with the right password -> 204", s == 204, str(s))
_, s, _ = login("admin2")
check("deactivated admin cannot log in", s == 401, str(s))
s, _ = admin.call("POST", f"/api/admin/users/{created_admin2['id']}/reactivate", {"admin_password": PW["admin"]})
check("reactivate ADMIN with the right password -> 204", s == 204, str(s))
_, s, _ = login("admin2")
check("reactivated admin logs in", s == 200, str(s))

# Password reset needs step-up (attempt 5 of 5) and kills the target's sessions.
s, _ = admin.call("POST", f"/api/admin/users/{judge['id']}/reset-password", {"new_password": PW["judge2"]})
check("reset without admin_password -> 422", s == 422, str(s))
s, _ = admin.call("POST", f"/api/admin/users/{judge['id']}/reset-password", {"new_password": PW["judge2"], "admin_password": PW["admin"]})
check("reset with the right password -> 204", s == 204, str(s))
s, _ = judge_client.call("GET", "/api/auth/me")
check("target's old session is dead after reset", s == 401, str(s))
_, s, _ = login("judge")
check("old password no longer works", s == 401, str(s))
_, s, _ = login("judge", PW["judge2"])
check("new password works", s == 200, str(s))

# The step-up budget is spent: a 6th verified attempt is rate limited.
s, _ = admin.call("POST", f"/api/admin/users/{judge['id']}/reset-password", {"new_password": PW["judge2"], "admin_password": WRONG})
check("6th step-up attempt in the window -> 429", s == 429, str(s))

# Users list and board paging.
s, users = admin.call("GET", "/api/admin/users?role=JUDGE")
check("users list exposes is_active", s == 200 and all("is_active" in u for u in users) and "password" not in json.dumps(users))
lawyer_client, s, _ = login("lawyer")
s, board0 = lawyer_client.call("GET", "/api/lawyer/board?limit=50&offset=0")
s2, board_far = lawyer_client.call("GET", "/api/lawyer/board?limit=50&offset=1000")
check("board offset beyond the data returns only opportunities (empty)", s == 200 and s2 == 200 and board_far == [], f"{s}/{s2}")

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
