"""Production smoke test for the TOTP second factor (leaves the account with 2FA disabled).

Env: SMOKE_EMAIL, SMOKE_PASSWORD (a dedicated test account), SMOKE_BYPASS_FILE (Vercel bypass token file).
Uses the app's own TOTP implementation to compute codes. Prints no secrets.
"""
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.security import totp  # noqa: E402

BASE = os.environ.get("SMOKE_BASE", "https://peacelaw.vercel.app")
EMAIL = os.environ["SMOKE_EMAIL"]
PASSWORD = os.environ["SMOKE_PASSWORD"]
BYPASS = open(os.environ["SMOKE_BYPASS_FILE"]).read().strip()
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
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


def wait_for_next_step(after):
    while totp.current_step() <= after:
        time.sleep(1)


c = Client()
s, _ = c.call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})
check("login before 2FA", s == 200, str(s))
s, st = c.call("GET", "/api/auth/totp")
check("2FA starts disabled", s == 200 and st["enabled"] is False, str(s))
s, setup = c.call("POST", "/api/auth/totp/setup", {"password": PASSWORD})
check("setup returns a secret and an otpauth URI", s == 200 and setup["uri"].startswith("otpauth://totp/"), str(s))
secret = setup["secret"]
step = totp.current_step()
s, enabled = c.call("POST", "/api/auth/totp/enable", {"code": totp.code_at(secret, step)})
check("enable with a valid code returns 8 recovery codes", s == 200 and len(enabled["recovery_codes"]) == 8, str(s))
recovery = enabled["recovery_codes"]
s, _ = c.call("GET", "/api/auth/me")
check("this browser stays signed in after enabling", s == 200, str(s))

fresh = Client()
s, body = fresh.call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})
check("login without a code asks for it", s == 401 and body.get("totp_required") is True, str(s))
s, body = fresh.call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD, "totp_code": "000000"})
check("a wrong code is refused", s == 401, str(s))
s, _ = fresh.call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD, "totp_code": totp.code_at(secret, step)})
check("replaying the enrolment code is refused", s == 401, str(s))
wait_for_next_step(step)
s, _ = fresh.call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD, "totp_code": totp.code_at(secret, totp.current_step())})
check("a fresh code logs in", s == 200, str(s))
other = Client()
s, _ = other.call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD, "totp_code": recovery[0]})
check("a recovery code logs in once", s == 200, str(s))
s, _ = Client().call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD, "totp_code": recovery[0]})
check("the same recovery code is refused the second time", s == 401, str(s))
s, _ = other.call("POST", "/api/auth/totp/disable", {"password": PASSWORD, "code": recovery[1]})
check("disable with password and a recovery code", s == 204, str(s))
s, _ = Client().call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})
check("login works without a code again", s == 200, str(s))

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
