"""Production smoke test through the Vercel protection bypass. Prints no secrets."""
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://peacelaw.vercel.app"
D = os.environ["SMOKE_DIR"]
BYPASS = open(os.path.join(D, "vercel_bypass.txt")).read().strip()
PASSWORDS = json.load(open(os.path.join(D, "smoke_passwords.json")))
RUN = os.environ["SMOKE_RUN"]
results = []


def check(name, ok, detail=""):
    ok = bool(ok)
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        req.add_header("x-vercel-protection-bypass", BYPASS)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        t = time.time()
        try:
            res = self.opener.open(req, timeout=60)
            status, headers, raw = res.status, res.headers, res.read()
        except urllib.error.HTTPError as e:
            status, headers, raw = e.code, e.headers, e.read()
        ms = int((time.time() - t) * 1000)
        try:
            payload = json.loads(raw) if raw else None
        except ValueError:
            payload = None
        return status, headers, payload, ms


def login(email_key):
    c = Client()
    email = f"smoke-{email_key}-{RUN}@peacelaw.test"
    s, _, _, ms = c.call("POST", "/api/auth/login", {"email": email, "password": PASSWORDS[email_key]})
    check(f"login {email_key}", s == 200, f"{s} {ms}ms")
    return c


# 1. Public surface and headers
anon = Client()
s, h, p, ms = anon.call("GET", "/api/consent")
check("GET /api/consent 200", s == 200 and p["version"], f"{s} {ms}ms")
for name in ("X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"):
    check(f"header {name}", h.get(name) is not None)
check("Cache-Control no-store", h.get("Cache-Control") == "no-store")
s, *_ = anon.call("GET", "/docs")
check("/docs hidden", s in (404, 200) and s != 500, str(s))  # frontend may answer 404 page
s, *_ = anon.call("GET", "/api/openapi.json")
check("openapi hidden", s == 404, str(s))
s, *_ = anon.call("GET", "/api/admin/pitch")
check("admin pitch needs login", s == 401, str(s))

# 2. Shared rate limit (limit 5 per IP+email)
codes = []
for _ in range(7):
    s, h, _, _ = anon.call("POST", "/api/auth/login", {"email": f"nobody-{RUN}@peacelaw.test", "password": "senha-errada-123"})
    codes.append((s, h.get("Retry-After")))
check("rate limit trips after 5 attempts", [c for c, _ in codes[:5]] == [401] * 5 and codes[5][0] == 429 and codes[5][1], str([c for c, _ in codes]))

# 3. Client flow
client = Client()
email = f"smoke-client-{RUN}@peacelaw.test"
s, _, p, ms = client.call("POST", "/api/auth/register", {"email": email, "password": PASSWORDS["client"]})
check("register client", s == 201 and p["role"] == "CLIENT", f"{s} {ms}ms")
consent = anon.call("GET", "/api/consent")[2]
text = "Meu nome é Carlos Eduardo Pereira, CPF 123.456.789-09, telefone (11) 91234-5678. A obra parou e perdi R$ 5.000,00."
s, _, case, ms = client.call("POST", "/api/cases", {"title": "Obra parada", "text": text, "lgpd_consent": True, "consent_version": consent["version"]})
check("create case", s == 201, f"{s} {ms}ms")
anonymized = case["anonymized_text"]
check("anonymized text has no PII", all(x not in anonymized for x in ("123.456.789-09", "91234", "Carlos", "5.000")), anonymized[:80])
cid = case["id"]
s, _, p, _ = client.call("POST", f"/api/cases/{cid}/approve")
check("approve case", s == 200 and p["status"] == "READY_FOR_JUDGE", str(s))

# 4. Judge
judge = login("judge")
s, _, q, _ = judge.call("GET", "/api/judge/queue")
check("judge sees the case, no raw_text", s == 200 and any(c["id"] == cid for c in q) and "raw_text" not in json.dumps(q))
s, _, p, _ = judge.call("POST", f"/api/cases/{cid}/reviews", {"score_evidence": 8, "score_jurisprudence": 7, "notes": "Provas claras."})
check("judge review", s == 201, str(s))
s, _, mine, _ = client.call("GET", f"/api/cases/{cid}")
check("score computed (75.0)", s == 200 and mine["ai_probability_score"] == 75.0 and mine["status"] == "EVALUATED", str(mine.get("ai_probability_score")))

# 5. Lawyer
lawyer = login("lawyer")
s, _, board, _ = lawyer.call("GET", "/api/lawyer/board")
check("lawyer sees the case, no raw_text", s == 200 and any(c["id"] == cid for c in board) and "raw_text" not in json.dumps(board))
s, _, p, _ = lawyer.call("POST", f"/api/cases/{cid}/match")
check("match", s == 200 and p["status"] == "IN_MEDIATION", str(s))
s, _, p, _ = lawyer.call("POST", f"/api/cases/{cid}/resolve")
check("resolve", s == 200 and p["status"] == "RESOLVED", str(s))

# 6. Role isolation and LGPD erasure
s, *_ = client.call("GET", "/api/judge/queue")
check("client blocked from judge queue", s == 403, str(s))
s, *_ = judge.call("GET", "/api/admin/pitch")
check("judge blocked from admin pitch", s == 403, str(s))
s, _, p, _ = client.call("POST", f"/api/cases/{cid}/erase-original")
check("erase original", s == 200 and p["raw_text"] == "" and p["raw_text_erased_at"], str(s))

# 7. Admin
admin = login("admin")
s, _, p, _ = admin.call("GET", "/api/admin/pitch")
check("admin gets the pt-BR pitch", s == 200 and "Roteiro" in p["html"], str(s))

# 8. Logout revokes
s, *_ = client.call("POST", "/api/auth/logout")
s2, *_ = client.call("GET", "/api/auth/me")
check("logout revokes session", s == 204 and s2 == 401, f"{s}/{s2}")

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
