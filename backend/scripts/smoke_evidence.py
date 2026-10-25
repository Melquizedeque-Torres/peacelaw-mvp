"""Production smoke test for evidence upload (plan B). Prints no secrets.

Env: SMOKE_DIR (holds vercel_bypass.txt and smoke_passwords.json with keys client, judge),
SMOKE_RUN (id used in the smoke account e-mails; the judge account must already exist).
"""
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("SMOKE_BASE", "https://peacelaw.vercel.app")
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

    def raw(self, method, path, body=None, headers=None):
        req = urllib.request.Request(BASE + path, data=body, method=method)
        req.add_header("x-vercel-protection-bypass", BYPASS)
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        t = time.time()
        try:
            res = self.opener.open(req, timeout=90)
            status, hdrs, content = res.status, res.headers, res.read()
        except urllib.error.HTTPError as e:
            status, hdrs, content = e.code, e.headers, e.read()
        return status, hdrs, content, int((time.time() - t) * 1000)

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        h = {"Content-Type": "application/json"} if data is not None else {}
        status, hdrs, content, ms = self.raw(method, path, data, h)
        try:
            payload = json.loads(content) if content else None
        except ValueError:
            payload = None
        return status, hdrs, payload, ms

    def upload(self, case_id, data, name):
        h = {"Content-Type": "application/octet-stream", "X-Filename": urllib.parse.quote(name)}
        status, hdrs, content, ms = self.raw("POST", f"/api/cases/{case_id}/evidence", data, h)
        try:
            return status, json.loads(content) if content else None, ms
        except ValueError:
            return status, None, ms


PDF = b"%PDF-1.4\n" + bytes(range(256)) * 20
TXT = "Conversa de WhatsApp de 12/03: o prestador admitiu o atraso.".encode()
EXE = b"MZ\x90\x00\x03\x00\x00\x00 fake executable"

anon = Client()
consent = anon.call("GET", "/api/consent")[2]
check("consent version is the current one", consent["version"] >= "2026-10-20", consent["version"])

client = Client()
email = f"smoke-client-{RUN}@peacelaw.test"
s, *_ = client.call("POST", "/api/auth/register", {"email": email, "password": PASSWORDS["client"]})
check("register client", s == 201, str(s))
text = "Contratei uma reforma e o prestador abandonou a obra após receber o pagamento adiantado, sem justificativa."
s, _, case, _ = client.call("POST", "/api/cases", {"title": "Reforma abandonada", "text": text, "lgpd_consent": True, "consent_version": consent["version"]})
check("create case", s == 201, str(s))
cid = case["id"]

s, meta, ms = client.upload(cid, PDF, "relatório final.pdf")
check("upload pdf", s == 201 and meta["content_type"] == "application/pdf", f"{s} {ms}ms")
check("filename sanitised to ASCII", meta["filename"] == "relatorio final.pdf", meta.get("filename"))
pdf_id = meta["id"]
s, meta2, _ = client.upload(cid, TXT, "whatsapp.txt")
check("upload txt", s == 201 and meta2["content_type"] == "text/plain", str(s))
s, _, _ = client.upload(cid, EXE, "virus.pdf")
check("exe renamed .pdf rejected (415)", s == 415, str(s))

s, _, items, _ = client.call("GET", f"/api/cases/{cid}/evidence")
check("list shows 2 files", s == 200 and len(items) == 2, str(s))
s, h, content, ms = client.raw("GET", f"/api/cases/{cid}/evidence/{pdf_id}")
check("download is byte-exact", s == 200 and content == PDF, f"{s} {ms}ms")
check("download is an attachment with nosniff", h.get("Content-Disposition", "").startswith("attachment") and h.get("X-Content-Type-Options") == "nosniff")

for i in range(3):
    client.upload(cid, TXT, f"extra{i}.txt")
s, _, _ = client.upload(cid, TXT, "sexto.txt")
check("6th file rejected (409)", s == 409, str(s))
s, *_ = client.call("DELETE", f"/api/cases/{cid}/evidence/{pdf_id}")
check("delete one", s == 204, str(s))

s, _, view, _ = client.call("GET", f"/api/cases/{cid}")
check("owner view has evidence_count 4", s == 200 and view["evidence_count"] == 4, str(view.get("evidence_count")))
s, _, p, _ = client.call("POST", f"/api/cases/{cid}/approve")
check("approve", s == 200, str(s))

# judge sees only the count
judge = Client()
s, *_ = judge.call("POST", "/api/auth/login", {"email": f"smoke-judge-{RUN}@peacelaw.test", "password": PASSWORDS["judge"]})
check("login judge", s == 200, str(s))
s, _, queue, _ = judge.call("GET", "/api/judge/queue")
mine = [c for c in queue if c["id"] == cid]
check("judge sees evidence_count 4 and nothing else about files", s == 200 and mine and mine[0]["evidence_count"] == 4 and "filename" not in json.dumps(queue) and "whatsapp" not in json.dumps(queue))
s, *_ = judge.call("GET", f"/api/cases/{cid}/evidence")
check("judge cannot list evidence (403)", s == 403, str(s))

# erase original wipes the attachments too
s, _, p, _ = client.call("POST", f"/api/cases/{cid}/erase-original")
check("erase original", s == 200 and p["raw_text"] == "" and p["evidence_count"] == 0, str(s))
s, _, items, _ = client.call("GET", f"/api/cases/{cid}/evidence")
check("evidence list empty after erase", s == 200 and items == [], str(items))
s, *_ = client.raw("GET", f"/api/cases/{cid}/evidence/{pdf_id}")
check("old attachment id is 404", s == 404, str(s))
s, _, _ = client.upload(cid, TXT, "depois.txt")
check("upload after erase refused (409)", s == 409, str(s))

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
