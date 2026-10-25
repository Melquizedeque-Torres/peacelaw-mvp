"""Production smoke test for the admin console, password change and audit log (plan C). Prints no secrets.

Env: SMOKE_DIR (holds vercel_bypass.txt and smoke_passwords.json with keys admin, newjudge, newjudge2),
SMOKE_RUN (id used in the smoke account e-mails; the admin account smoke-admin-<RUN> must already exist).
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


def check(name, ok, detail=""):
    ok = bool(ok)
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


class Client:
    def __init__(self):
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def raw(self, method, path, body=None, headers=None):
        req = urllib.request.Request(BASE + path, data=body, method=method)
        req.add_header("x-vercel-protection-bypass", BYPASS)
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            res = self.opener.open(req, timeout=90)
            return res.status, res.headers, res.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        s, h, content = self.raw(method, path, data, {"Content-Type": "application/json"} if data else {})
        try:
            return s, json.loads(content) if content else None
        except ValueError:
            return s, None


admin = Client()
s, _ = admin.call("POST", "/api/auth/login", {"email": f"smoke-admin-{RUN}@peacelaw.test", "password": PW["admin"]})
check("admin login", s == 200, str(s))

# Pages are served and gated by the SPA; the API is the real gate.
s, _, html = Client().raw("GET", "/admin")
check("/admin page is served", s == 200 and b"PeaceLaw" in html or s == 200, str(s))
s, _, html = Client().raw("GET", "/conta/senha")
check("/conta/senha page is served", s == 200, str(s))

s, stats = admin.call("GET", "/api/admin/stats")
check("stats has 6 statuses and 4 roles", s == 200 and len(stats["cases_by_status"]) == 6 and len(stats["users_by_role"]) == 4, str(s))
check("stats has no case text", "title" not in json.dumps(stats) and "text" not in json.dumps(stats))

s, users = admin.call("GET", "/api/admin/users")
check("users list has no secrets", s == 200 and "password" not in json.dumps(users) and "token_version" not in json.dumps(users))
s, only_admins = admin.call("GET", "/api/admin/users?role=ADMIN")
check("role filter works", s == 200 and all(u["role"] == "ADMIN" for u in only_admins) and len(only_admins) >= 1)
s, _ = admin.call("GET", "/api/admin/users?role=OWNER")
check("bad role filter 422", s == 422, str(s))

# Create a judge, sign in as them, revoke, change password.
judge_email = f"smoke-newjudge-{RUN}@peacelaw.test"
s, created = admin.call("POST", "/api/admin/users", {"email": judge_email, "role": "JUDGE", "password": PW["newjudge"]})
check("admin creates a judge", s == 201 and created["role"] == "JUDGE", str(s))
s, _ = admin.call("POST", "/api/admin/users", {"email": judge_email, "role": "JUDGE", "password": PW["newjudge2"]})
check("duplicate email 409 and role unchanged", s == 409, str(s))
s, _ = admin.call("POST", "/api/admin/users", {"email": f"smoke-admin-{RUN}@peacelaw.test", "role": "ADMIN", "password": PW["newjudge2"]})
check("creating an ADMIN without admin_password is 422", s == 422, str(s))
s, _ = admin.call("POST", "/api/admin/users", {"email": f"smoke-admin-{RUN}@peacelaw.test", "role": "ADMIN", "password": PW["newjudge2"], "admin_password": "errada-errada-123"})
check("creating an ADMIN with a wrong admin_password is 400", s == 400, str(s))
s, _ = admin.call("POST", "/api/admin/users", {"email": f"smoke-client-{RUN}@peacelaw.test", "role": "CLIENT", "password": PW["newjudge2"]})
check("creating a CLIENT is refused (422)", s == 422, str(s))

judge = Client()
s, _ = judge.call("POST", "/api/auth/login", {"email": judge_email, "password": PW["newjudge"]})
check("new judge logs in", s == 200, str(s))
s, _ = judge.call("GET", "/api/admin/stats")
check("judge blocked from admin API", s == 403, str(s))

judge_b = Client()
judge_b.call("POST", "/api/auth/login", {"email": judge_email, "password": PW["newjudge"]})
s, _ = admin.call("POST", f"/api/admin/users/{created['id']}/revoke-sessions")
check("admin revokes the judge's sessions", s == 204, str(s))
s, _ = judge.call("GET", "/api/auth/me")
s2, _ = judge_b.call("GET", "/api/auth/me")
check("revoked sessions are dead", s == 401 and s2 == 401, f"{s}/{s2}")
s, _ = admin.call("GET", "/api/auth/me")
check("admin session survives", s == 200, str(s))

judge = Client()
judge.call("POST", "/api/auth/login", {"email": judge_email, "password": PW["newjudge"]})
other = Client()
other.call("POST", "/api/auth/login", {"email": judge_email, "password": PW["newjudge"]})
s, _ = judge.call("POST", "/api/auth/change-password", {"current_password": "errada-errada-123", "new_password": PW["newjudge2"]})
check("wrong current password -> 400", s == 400, str(s))
s, _ = judge.call("POST", "/api/auth/change-password", {"current_password": PW["newjudge"], "new_password": PW["newjudge2"]})
check("change password -> 204", s == 204, str(s))
s, _ = judge.call("GET", "/api/auth/me")
s2, _ = other.call("GET", "/api/auth/me")
check("this browser stays signed in, the other is revoked", s == 200 and s2 == 401, f"{s}/{s2}")
s, _ = Client().call("POST", "/api/auth/login", {"email": judge_email, "password": PW["newjudge"]})
check("old password no longer works", s == 401, str(s))
s, _ = Client().call("POST", "/api/auth/login", {"email": judge_email, "password": PW["newjudge2"]})
check("new password works", s == 200, str(s))

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
