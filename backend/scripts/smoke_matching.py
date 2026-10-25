"""Production smoke test for rule-based lawyer matchmaking (plan E). Prints no secrets.

Env: SMOKE_DIR (holds vercel_bypass.txt and smoke_passwords.json with keys client, judge, lawyer),
SMOKE_RUN (id used in the smoke account e-mails; judge and lawyer accounts must already exist).
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


def login(key):
    c = Client()
    s, _ = c.call("POST", "/api/auth/login", {"email": f"smoke-{key}-{RUN}@peacelaw.test", "password": PW[key]})
    check(f"login {key}", s == 200, str(s))
    return c


consent = Client().call("GET", "/api/consent")[1]
client = Client()
s, _ = client.call("POST", "/api/auth/register", {"email": f"smoke-client-{RUN}@peacelaw.test", "password": PW["client"]})
check("register client", s == 201, str(s))
TEXT = "O contrato de locação previa reajuste anual, mas o proprietário cobrou valores acima do combinado e recusou a vistoria."


def new_case(title, area):
    body = {"title": title, "text": TEXT, "lgpd_consent": True, "consent_version": consent["version"]}
    if area:
        body["area"] = area
    s, c = client.call("POST", "/api/cases", body)
    check(f"create case {title} ({area or 'default'})", s == 201, str(s))
    client.call("POST", f"/api/cases/{c['id']}/approve")
    return c


rent = new_case("Aluguel abusivo", "ALUGUEL")
civil = new_case("Cobranca civel", "CIVIL")
plain = new_case("Sem area", None)
check("default area is OUTROS", plain["area"] == "OUTROS", plain["area"])
s, _ = client.call("POST", "/api/cases", {"title": "x", "text": TEXT, "lgpd_consent": True, "consent_version": consent["version"], "area": "PENAL"})
check("invalid area rejected (422)", s == 422, str(s))

judge = login("judge")
s, queue = judge.call("GET", "/api/judge/queue")
check("judge sees the areas", s == 200 and {c["id"]: c["area"] for c in queue}.get(rent["id"]) == "ALUGUEL", str(s))
check("judge does not see 'suggested'", "suggested" not in json.dumps(queue))
for case, ev, ju in ((rent, 3, 3), (civil, 9, 9)):
    s, _ = judge.call("POST", f"/api/cases/{case['id']}/reviews", {"score_evidence": ev, "score_jurisprudence": ju, "notes": "ok"})
    check(f"review {case['title']}", s == 201, str(s))

lawyer = login("lawyer")
s, board = lawyer.call("GET", "/api/lawyer/board")
ids = [c["id"] for c in board if c["id"] in (rent["id"], civil["id"])]
check("no areas: pure score order (civil 90 then rent 30)", ids == [civil["id"], rent["id"]], str(ids))
check("nothing suggested yet", not any(c["suggested"] for c in board))
s, a = lawyer.call("GET", "/api/lawyer/areas")
check("areas start empty", s == 200 and a == {"areas": []}, str(a))
s, a = lawyer.call("PUT", "/api/lawyer/areas", {"areas": ["ALUGUEL", "ALUGUEL"]})
check("PUT areas de-duplicates", s == 200 and a == {"areas": ["ALUGUEL"]}, str(a))
s, _ = lawyer.call("PUT", "/api/lawyer/areas", {"areas": ["PENAL"]})
check("PUT invalid area 422", s == 422, str(s))
s, board = lawyer.call("GET", "/api/lawyer/board")
mine = [c for c in board if c["id"] in (rent["id"], civil["id"])]
check("suggested case first with the flag", [c["id"] for c in mine] == [rent["id"], civil["id"]] and mine[0]["suggested"] and not mine[1]["suggested"], str([(c["area"], c["suggested"]) for c in mine]))
s, p = lawyer.call("POST", f"/api/cases/{civil['id']}/match")
check("match is not restricted by area", s == 200 and p["status"] == "IN_MEDIATION" and p["suggested"] is False, str(s))

s1, _ = client.call("GET", "/api/lawyer/areas")
s2, _ = judge.call("PUT", "/api/lawyer/areas", {"areas": []})
check("client/judge blocked from areas API", s1 == 403 and s2 == 403, f"{s1}/{s2}")
s, view = client.call("GET", f"/api/cases/{rent['id']}")
check("owner view has area and no 'suggested'", s == 200 and view["area"] == "ALUGUEL" and "suggested" not in view)

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
