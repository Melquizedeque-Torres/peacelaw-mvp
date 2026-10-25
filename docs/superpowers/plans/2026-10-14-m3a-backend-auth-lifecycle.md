# M3a — Backend: Auth, RBAC, Case Lifecycle, Encryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the FastAPI backend with the NotebookLM sources: JWT cookie auth with RBAC, the six-state case lifecycle, judge scoring (Provas + Jurisprudência) driving `ai_probability_score`, lawyer match/resolve, `raw_text` encrypted at rest, and the extended PII redaction set.

**Architecture:** `app/security/` holds primitives (Fernet column encryption, Argon2 passwords, JWT). `app/deps.py` turns the session cookie into a `User` and enforces roles. Routers are split by actor: `auth`, `cases` (client), `judge`, `lawyer`. `app/scoring.py` is a pure function. One Alembic revision migrates the Neon schema (enum conversion + in-place encryption of existing rows).

**Tech Stack:** FastAPI, SQLAlchemy 2.1, Pydantic 2, Alembic, PyJWT 2.15, pwdlib[argon2] 0.3, cryptography 50 (Fernet), pytest.

**Spec:** `docs/superpowers/specs/2026-10-14-peacelaw-mvp-design.md` — section "Milestone 3 — decisions from the NotebookLM sources".

## Global Constraints

- All backend commands run from `backend/` with `.venv/Scripts/python -m <tool>` (Windows + Git Bash).
- `raw_text` (the client's original report) must never appear in any judge- or lawyer-facing response, error body, or log. Only the owner's view (`CaseOwnerView`) may contain it.
- Never print, log, commit or echo `backend/.env` (holds the Neon password, `JWT_SECRET`, `RAW_TEXT_KEYS`).
- Tests never touch Neon (conftest forces in-memory SQLite and test keys).
- User-facing error messages in pt-BR; identifiers in English.
- Exact error strings (tests depend on them): `"Não autenticado."` (401), `"Acesso negado."` (403), `"E-mail ou senha inválidos."` (401), `"E-mail já cadastrado."` (409), `"Caso não encontrado."` (404), `"Transição de status inválida."` (409), `"Este caso não pode mais ser excluído."` (409), `"Você já avaliou este caso."` (409), `"Este caso não aceita mais avaliações."` (409), `"Este caso já está em mediação."` (409).
- Test output pristine (no warnings). `alembic check` clean after Task 3.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

---

### Task 1: Redaction — financial amounts, bank data, RG, CNH, passport

**Files:**
- Modify: `backend/app/privacy/redaction.py` (docstring + `_PATTERNS`)
- Modify: `backend/tests/test_redaction.py`

**Interfaces:**
- Produces: new labels `VALOR`, `BANCO`, `RG`, `CNH`, `PASSAPORTE` (in addition to `EMAIL`, `CNPJ`, `CPF`, `TELEFONE`, `CEP`, `ENDERECO`, `EMPRESA`, `NOME`). `redact_pii` signature unchanged.

- [ ] **Step 1: Update/add the failing tests** in `backend/tests/test_redaction.py`

Replace the expected text in `test_redacts_all_pii_in_design_system_example` (the amount is now redacted):
```python
    assert result.text == (
        "Contratei a [EMPRESA] para reformar meu apartamento na [ENDERECO], "
        "em março de 2026. Paguei [VALOR] em duas parcelas. O responsável, [NOME], "
        "abandonou a obra na metade e não responde mais às mensagens. Meu CPF é [CPF] "
        "e meu telefone é [TELEFONE]."
    )
```
and in that test's secret list add `"18.400"`.

Replace `test_counts_follow_order_of_appearance` body with:
```python
    result = redact_pii(EXAMPLE)
    assert list(result.counts) == ["EMPRESA", "ENDERECO", "VALOR", "NOME", "CPF", "TELEFONE"]
    assert result.counts == {
        "EMPRESA": 1, "ENDERECO": 1, "VALOR": 1, "NOME": 1, "CPF": 1, "TELEFONE": 1,
    }
```

Append:
```python
@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Paguei R$ 18.400 em duas parcelas.", "Paguei [VALOR] em duas parcelas."),
        ("valor de R$ 1.234,56 e depois R$5.", "valor de [VALOR] e depois [VALOR]."),
        ("Agência 1234-5, conta corrente 98765-4 no banco.", "[BANCO], [BANCO] no banco."),
        ("ag. 0001 c/c 123456-7", "[BANCO] [BANCO]"),
        ("Meu RG 12.345.678-9 e RG nº MG-12.345.678", "Meu [RG] e [RG]"),
        ("RG: 1234567 emitido", "[RG] emitido"),
        ("CNH nº 12345678901 válida", "[CNH] válida"),
        ("passaporte FZ123456 e AB654321", "[PASSAPORTE] e [PASSAPORTE]"),
    ],
)
def test_redacts_financial_and_document_data(text, expected):
    assert redact_pii(text).text == expected


def test_prose_words_are_not_mistaken_for_bank_data():
    text = "a conta de luz chegou e a agência fechou cedo."
    assert redact_pii(text).text == text
```

Extend the `adversarial` parametrize list of `test_adversarial_20k_inputs_redact_in_bounded_time` with:
`"R$ " + "1." * 9_000`, `"conta " + "1" * 19_990`, `"RG " + "1" * 19_990`, `"Agência " + "1" * 19_990`, `"AB" * 9_999`.

- [ ] **Step 2: Run to verify failure**

Run: `.venv/Scripts/python -m pytest tests/test_redaction.py -q`
Expected: the new/changed tests FAIL (amount not redacted, new labels missing).

- [ ] **Step 3: Implement** — in `backend/app/privacy/redaction.py`:

Replace the first docstring paragraph with:
```python
"""Rule-based PII redaction (MVP layer of Privacy by Design).

Ported from the design system's client-side `redact()`; extended with CNPJ, CEP,
financial amounts, bank data, RG, CNH and passport (Segurança/LGPD source).
```
(keep the rest of the docstring as is).

Insert these entries into `_PATTERNS` **right after the `EMAIL` entry and before `CNPJ`** (keyword-anchored document patterns must win over the generic CPF/phone patterns):
```python
    ("VALOR", re.compile(r"R\$\s?\d[\d.,]{0,20}\d|R\$\s?\d")),
    ("BANCO", re.compile(
        r"\b(?i:ag(?:ência|encia|\.))\s*(?:n[º°o.]?\s*)?:?\s*\d{3,5}(?:-[\dXx])?"
        r"|\b(?i:conta(?:\s+corrente|\s+poupança)?|c/c)\s*(?:n[º°o.]?\s*)?:?\s*\d{3,12}(?:-[\dXx])?"
    )),
    ("RG", re.compile(
        r"\b(?:RG|R\.G\.)\s*(?:n[º°o.]?\s*)?:?\s*(?:[A-Z]{2}-?)?[\dXx][\dXx.\-]{4,14}[\dXx]"
        r"|\b\d{1,2}\.\d{3}\.\d{3}-[\dXx]\b"
    )),
    ("CNH", re.compile(r"\bCNH\b\s*(?:n[º°o.]?\s*)?:?\s*\d{9,11}")),
    ("PASSAPORTE", re.compile(
        r"(?:\b(?i:passaporte)\s*(?:n[º°o.]?\s*)?:?\s*)?\b[A-Z]{2}\d{6}\b"
    )),
```

- [ ] **Step 4: Run tests** — `.venv/Scripts/python -m pytest -q` → all pass, no warnings.

- [ ] **Step 5: Commit**
```bash
git add backend/app/privacy/redaction.py backend/tests/test_redaction.py
git commit -m "feat(privacy): redact amounts, bank data, RG, CNH and passport"
```

---

### Task 2: Security primitives — config, column encryption, passwords, JWT

**Files:**
- Modify: `backend/requirements.txt`, `backend/.env.example`, `backend/app/config.py`, `backend/tests/conftest.py`, `backend/tests/test_config.py`
- Create: `backend/app/security/__init__.py` (empty), `backend/app/security/crypto.py`, `backend/app/security/passwords.py`, `backend/app/security/tokens.py`
- Test: `backend/tests/test_security.py`

**Interfaces:**
- Produces:
  - `app.config.get_jwt_secret() -> str` (RuntimeError if missing or < 32 chars), `get_raw_text_keys() -> list[str]` (RuntimeError if empty), `cookie_secure() -> bool` (`COOKIE_SECURE=true`).
  - `app.security.crypto`: `encrypt_text(str) -> str`, `decrypt_text(str) -> str`, `EncryptedText` (SQLAlchemy `TypeDecorator` over `Text`), cached `_fernet()` with `.cache_clear()`.
  - `app.security.passwords`: `hash_password(str) -> str`, `verify_password(password: str, password_hash: str | None) -> bool` (does dummy work when hash is None; unknown hash formats → False).
  - `app.security.tokens`: `ACCESS_TOKEN_MINUTES = 60`, `create_access_token(user_id: uuid.UUID) -> str`, `decode_access_token(token: str) -> uuid.UUID | None`.
  - conftest constants `TEST_JWT_SECRET`, `TEST_RAW_TEXT_KEY`; autouse fixture sets `JWT_SECRET` and `RAW_TEXT_KEYS` and clears `_fernet` cache.

- [ ] **Step 1: Dependencies** — append to `backend/requirements.txt`:
```text
pyjwt>=2.10
pwdlib[argon2]>=0.3
cryptography>=44
```
Run: `.venv/Scripts/python -m pip install -r requirements-dev.txt`

- [ ] **Step 2: `.env.example`** — append:
```dotenv

# JWT signing secret, at least 32 characters. Generate with:
#   python -c "import secrets; print(secrets.token_urlsafe(48))"
JWT_SECRET=

# Fernet keys for raw_text encryption at rest, comma-separated; the FIRST key
# encrypts, all keys decrypt (rotation: prepend a new key). Generate with:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
RAW_TEXT_KEYS=

# Set to true behind HTTPS so the session cookie gets the Secure flag.
# COOKIE_SECURE=false
```

- [ ] **Step 3: Write failing tests**

Append to `backend/tests/test_config.py`:
```python
from app.config import cookie_secure, get_jwt_secret, get_raw_text_keys


def test_jwt_secret_must_be_long(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "curto")
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        get_jwt_secret()


def test_raw_text_keys_are_split_and_required(monkeypatch):
    monkeypatch.setenv("RAW_TEXT_KEYS", " k1 , k2 ,")
    assert get_raw_text_keys() == ["k1", "k2"]
    monkeypatch.setenv("RAW_TEXT_KEYS", "")
    with pytest.raises(RuntimeError, match="RAW_TEXT_KEYS"):
        get_raw_text_keys()


def test_cookie_secure_flag(monkeypatch):
    monkeypatch.delenv("COOKIE_SECURE", raising=False)
    assert cookie_secure() is False
    monkeypatch.setenv("COOKIE_SECURE", "true")
    assert cookie_secure() is True
```

Create `backend/tests/test_security.py`:
```python
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.fernet import Fernet

from app.security import crypto
from app.security.passwords import hash_password, verify_password
from app.security.tokens import create_access_token, decode_access_token


def test_encrypt_roundtrip_hides_plaintext():
    token = crypto.encrypt_text("Meu CPF é 123.456.789-00")
    assert "123.456.789-00" not in token
    assert token.startswith("gAAAA")
    assert crypto.decrypt_text(token) == "Meu CPF é 123.456.789-00"


def test_key_rotation_first_key_encrypts_all_keys_decrypt(monkeypatch):
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    monkeypatch.setenv("RAW_TEXT_KEYS", old)
    crypto._fernet.cache_clear()
    legacy = crypto.encrypt_text("relato antigo")

    monkeypatch.setenv("RAW_TEXT_KEYS", f"{new},{old}")
    crypto._fernet.cache_clear()
    assert crypto.decrypt_text(legacy) == "relato antigo"
    fresh = crypto.encrypt_text("relato novo")
    assert Fernet(new.encode()).decrypt(fresh.encode()).decode() == "relato novo"


def test_encryption_requires_keys(monkeypatch):
    monkeypatch.delenv("RAW_TEXT_KEYS", raising=False)
    crypto._fernet.cache_clear()
    with pytest.raises(RuntimeError, match="RAW_TEXT_KEYS"):
        crypto.encrypt_text("x")


def test_password_hash_and_verify():
    hashed = hash_password("senha-forte-123")
    assert hashed.startswith("$argon2")
    assert verify_password("senha-forte-123", hashed) is True
    assert verify_password("senha-errada-123", hashed) is False


def test_verify_password_handles_missing_and_unusable_hashes():
    assert verify_password("qualquer-coisa-1", None) is False
    assert verify_password("qualquer-coisa-1", "!") is False


def test_token_roundtrip():
    user_id = uuid.uuid4()
    assert decode_access_token(create_access_token(user_id)) == user_id


def test_tampered_expired_and_foreign_tokens_are_rejected():
    from tests.conftest import TEST_JWT_SECRET

    user_id = uuid.uuid4()
    assert decode_access_token(create_access_token(user_id) + "x") is None
    expired = jwt.encode(
        {"sub": str(user_id), "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
        TEST_JWT_SECRET,
        algorithm="HS256",
    )
    assert decode_access_token(expired) is None
    foreign = jwt.encode(
        {"sub": str(user_id), "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
        "outro-segredo-" + "y" * 40,
        algorithm="HS256",
    )
    assert decode_access_token(foreign) is None
    unsigned = jwt.encode({"sub": str(user_id)}, TEST_JWT_SECRET, algorithm="HS256")
    assert decode_access_token(unsigned) is None  # no exp claim
    assert decode_access_token("lixo") is None
```

Update `backend/tests/conftest.py`: add imports and constants at the top, and extend the autouse fixture:
```python
from cryptography.fernet import Fernet

from app.security.crypto import _fernet

TEST_JWT_SECRET = "segredo-de-teste-" + "x" * 40
TEST_RAW_TEXT_KEY = Fernet.generate_key().decode()
```
```python
@pytest.fixture(autouse=True)
def _isolate_database_url(monkeypatch):
    """Guarantee no test can fall through to Neon or real secrets."""
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("JWT_SECRET", TEST_JWT_SECRET)
    monkeypatch.setenv("RAW_TEXT_KEYS", TEST_RAW_TEXT_KEY)
    get_engine.cache_clear()
    _session_factory.cache_clear()
    _fernet.cache_clear()
    yield
    get_engine.cache_clear()
    _session_factory.cache_clear()
    _fernet.cache_clear()
```

- [ ] **Step 4: Run to verify failure** — `.venv/Scripts/python -m pytest tests/test_security.py tests/test_config.py -q` → FAIL (modules missing).

- [ ] **Step 5: Implement**

Append to `backend/app/config.py`:
```python
def get_jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("JWT_SECRET ausente ou curto demais (mínimo de 32 caracteres).")
    return secret


def get_raw_text_keys() -> list[str]:
    keys = [k.strip() for k in os.environ.get("RAW_TEXT_KEYS", "").split(",") if k.strip()]
    if not keys:
        raise RuntimeError(
            "RAW_TEXT_KEYS não definido. Gere uma chave com: python -c "
            "\"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    return keys


def cookie_secure() -> bool:
    return os.environ.get("COOKIE_SECURE", "false").strip().lower() == "true"
```

`backend/app/security/crypto.py`:
```python
"""Column-level encryption at rest for raw_text (Segurança/LGPD source: mandatory).

MultiFernet: the first key in RAW_TEXT_KEYS encrypts, every key can decrypt, so a key
is rotated by prepending a new one and re-saving rows at leisure.
"""

from functools import lru_cache

from cryptography.fernet import Fernet, MultiFernet
from sqlalchemy import Dialect, Text
from sqlalchemy.types import TypeDecorator

from app.config import get_raw_text_keys


@lru_cache
def _fernet() -> MultiFernet:
    return MultiFernet([Fernet(key.encode("ascii")) for key in get_raw_text_keys()])


def encrypt_text(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_text(token: str) -> str:
    return _fernet().decrypt(token.encode("ascii")).decode("utf-8")


class EncryptedText(TypeDecorator[str]):
    """Text column stored as a Fernet token; plaintext only exists in Python."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect: Dialect) -> str | None:
        return None if value is None else encrypt_text(value)

    def process_result_value(self, value: str | None, dialect: Dialect) -> str | None:
        return None if value is None else decrypt_text(value)
```

`backend/app/security/passwords.py`:
```python
from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError

_hasher = PasswordHash.recommended()  # Argon2id
# Verifying against a dummy hash when the e-mail is unknown keeps login timing
# similar for existing and non-existing accounts.
_DUMMY_HASH = _hasher.hash("peacelaw-timing-equalizer")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if password_hash is None:
        _hasher.verify(password, _DUMMY_HASH)
        return False
    try:
        return _hasher.verify(password, password_hash)
    except UnknownHashError:
        return False
```

`backend/app/security/tokens.py`:
```python
import uuid
from datetime import datetime, timedelta, timezone

import jwt

from app.config import get_jwt_secret

ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60


def create_access_token(user_id: uuid.UUID) -> str:
    now = datetime.now(timezone.utc)
    claims = {"sub": str(user_id), "iat": now, "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES)}
    return jwt.encode(claims, get_jwt_secret(), algorithm=ALGORITHM)


def decode_access_token(token: str) -> uuid.UUID | None:
    """Return the user id of a valid, unexpired token signed by us; otherwise None.

    The role is deliberately not trusted from the token: callers load the user from
    the database so role changes and deletions take effect immediately.
    """
    try:
        claims = jwt.decode(
            token, get_jwt_secret(), algorithms=[ALGORITHM], options={"require": ["sub", "exp"]}
        )
        return uuid.UUID(claims["sub"])
    except (jwt.InvalidTokenError, ValueError):
        return None
```

- [ ] **Step 6: Run all tests** — `.venv/Scripts/python -m pytest -q` → all pass, no warnings.

- [ ] **Step 7: Commit**
```bash
git add backend/requirements.txt backend/.env.example backend/app/config.py backend/app/security backend/tests/conftest.py backend/tests/test_config.py backend/tests/test_security.py
git commit -m "feat(security): column encryption, Argon2 passwords and JWT primitives"
```

---

### Task 3: Models, scoring and the Neon migration

**Precondition (controller):** `backend/.env` already contains `JWT_SECRET` and `RAW_TEXT_KEYS` (needed by the migration to encrypt existing rows). Never print it.

**Files:**
- Modify: `backend/app/models.py`, `backend/main.py`
- Create: `backend/app/scoring.py`, `backend/migrations/versions/5d2a9c41e7b3_m3_auth_lifecycle_encryption.py`, `backend/tests/test_app.py`, `backend/tests/test_scoring.py`
- Rewrite: `backend/tests/test_models.py`
- Delete: `backend/app/routers/cases.py`, `backend/tests/test_cases_api.py` (the M1 unauthenticated API; replaced in Tasks 4–6)

**Interfaces:**
- Consumes: `EncryptedText`, `hash_password`.
- Produces:
  - `CaseStatus`: `DRAFT, AWAITING_APPROVAL, READY_FOR_JUDGE, EVALUATED, IN_MEDIATION, RESOLVED`.
  - `User.password_hash: str`; `Case.title: str`, `Case.raw_text` (encrypted), `Case.ai_probability_score: float | None`, `Case.lawyer_id: UUID | None`, relationships `Case.client`, `Case.lawyer`, `Case.reviews`; `CaseReview.score_evidence: int`, `CaseReview.score_jurisprudence: int` (0–10), unique `(case_id, judge_id)`.
  - `app.scoring.judge_score(evidence: int, jurisprudence: int) -> float`, `probability_score(reviews: Sequence[ScoredReview]) -> float | None`.
  - `main.app` without the cases router (re-added in Task 5); `tests/test_app.py` keeps health + CORS coverage.

- [ ] **Step 1: Write failing tests**

`backend/tests/test_scoring.py`:
```python
from types import SimpleNamespace

from app.scoring import judge_score, probability_score


def review(evidence: int, jurisprudence: int) -> SimpleNamespace:
    return SimpleNamespace(score_evidence=evidence, score_jurisprudence=jurisprudence)


def test_judge_score_is_the_mean_of_both_criteria():
    assert judge_score(8, 6) == 7.0


def test_no_reviews_means_no_score():
    assert probability_score([]) is None


def test_score_is_mean_of_judge_scores_times_ten():
    assert probability_score([review(8, 6), review(9, 7)]) == 75.0


def test_score_is_rounded_to_one_decimal():
    assert probability_score([review(8, 7), review(6, 6), review(5, 5)]) == 61.7


def test_score_bounds():
    assert probability_score([review(0, 0)]) == 0.0
    assert probability_score([review(10, 10)]) == 100.0
```

`backend/tests/test_models.py` (replace the whole file):
```python
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.models import Case, CaseReview, CaseStatus, User, UserRole

PLAIN = "Meu CPF é 123.456.789-00 e a obra parou."


def _user(session, role=UserRole.CLIENT, email=None):
    user = User(email=email or f"{role.value.lower()}@exemplo.com", role=role, password_hash="!")
    session.add(user)
    session.commit()
    return user


def _case(session, client, **extra):
    case = Case(
        client_id=client.id,
        title="Obra abandonada",
        raw_text=PLAIN,
        anonymized_text="Meu CPF é [CPF] e a obra parou.",
        **extra,
    )
    session.add(case)
    session.commit()
    return case


def test_case_defaults(session):
    case = _case(session, _user(session))
    session.refresh(case)
    assert case.status is CaseStatus.AWAITING_APPROVAL
    assert case.ai_probability_score is None
    assert case.lawyer_id is None
    assert case.client.email == "client@exemplo.com"


def test_raw_text_is_encrypted_at_rest(session):
    case = _case(session, _user(session))
    stored = session.execute(text("SELECT raw_text FROM cases")).scalar_one()
    assert "123.456.789-00" not in stored
    assert stored.startswith("gAAAA")
    session.expire_all()
    assert session.get(Case, case.id).raw_text == PLAIN


def test_lawyer_assignment(session):
    lawyer = _user(session, UserRole.LAWYER)
    case = _case(session, _user(session), lawyer_id=lawyer.id, status=CaseStatus.IN_MEDIATION)
    session.refresh(case)
    assert case.lawyer.role is UserRole.LAWYER
    assert lawyer.cases == []  # `User.cases` lists cases the user OWNS, not mediates


@pytest.mark.parametrize("field", ["score_evidence", "score_jurisprudence"])
@pytest.mark.parametrize("value", [-1, 11])
def test_review_scores_are_between_0_and_10(session, field, value):
    case = _case(session, _user(session))
    judge = _user(session, UserRole.JUDGE)
    scores = {"score_evidence": 5, "score_jurisprudence": 5, field: value}
    session.add(CaseReview(case_id=case.id, judge_id=judge.id, **scores))
    with pytest.raises(IntegrityError):
        session.commit()


def test_one_review_per_judge_per_case(session):
    case = _case(session, _user(session))
    judge = _user(session, UserRole.JUDGE)
    session.add(CaseReview(case_id=case.id, judge_id=judge.id, score_evidence=5, score_jurisprudence=5))
    session.commit()
    session.add(CaseReview(case_id=case.id, judge_id=judge.id, score_evidence=6, score_jurisprudence=6))
    with pytest.raises(IntegrityError):
        session.commit()


def test_user_email_is_unique(session):
    _user(session, email="dup@exemplo.com")
    session.add(User(email="dup@exemplo.com", role=UserRole.LAWYER, password_hash="!"))
    with pytest.raises(IntegrityError):
        session.commit()
```

`backend/tests/test_app.py`:
```python
from fastapi.testclient import TestClient

from main import app


def test_health():
    assert TestClient(app).get("/health").json() == {"status": "ok"}


def test_cors_preflight_allows_configured_origin_only():
    client = TestClient(app)
    allowed = client.options(
        "/health",
        headers={"Origin": "http://127.0.0.1:3000", "Access-Control-Request-Method": "GET"},
    )
    assert allowed.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"
    assert allowed.headers["access-control-allow-credentials"] == "true"

    denied = client.options(
        "/health",
        headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in denied.headers
```

- [ ] **Step 2: Run to verify failure** — `.venv/Scripts/python -m pytest tests/test_models.py tests/test_scoring.py tests/test_app.py -q` → FAIL.

- [ ] **Step 3: Implement the models** — replace `backend/app/models.py`:
```python
import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.security.crypto import EncryptedText


class UserRole(str, enum.Enum):
    CLIENT = "CLIENT"
    JUDGE = "JUDGE"
    LAWYER = "LAWYER"
    ADMIN = "ADMIN"


class CaseStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    READY_FOR_JUDGE = "READY_FOR_JUDGE"
    EVALUATED = "EVALUATED"
    IN_MEDIATION = "IN_MEDIATION"
    RESOLVED = "RESOLVED"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    cases: Mapped[list["Case"]] = relationship(
        back_populates="client", foreign_keys="Case.client_id"
    )


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    lawyer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    # Stored already redacted: the title is visible to judges and lawyers.
    title: Mapped[str] = mapped_column(String(200))
    # Privacy by Design: owner-only, encrypted at rest, never in a third-party schema.
    raw_text: Mapped[str] = mapped_column(EncryptedText)
    anonymized_text: Mapped[str] = mapped_column(Text)
    status: Mapped[CaseStatus] = mapped_column(
        Enum(CaseStatus, name="case_status"), default=CaseStatus.AWAITING_APPROVAL
    )
    ai_probability_score: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    client: Mapped[User] = relationship(back_populates="cases", foreign_keys=[client_id])
    lawyer: Mapped[User | None] = relationship(foreign_keys=[lawyer_id])
    reviews: Mapped[list["CaseReview"]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )


class CaseReview(Base):
    __tablename__ = "case_reviews"
    __table_args__ = (
        CheckConstraint("score_evidence BETWEEN 0 AND 10", name="evidence_range"),
        CheckConstraint("score_jurisprudence BETWEEN 0 AND 10", name="jurisprudence_range"),
        UniqueConstraint("case_id", "judge_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), index=True
    )
    judge_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    score_evidence: Mapped[int]
    score_jurisprudence: Mapped[int]
    # Stored redacted (judges write free text).
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    case: Mapped[Case] = relationship(back_populates="reviews")
    judge: Mapped[User] = relationship()
```

- [ ] **Step 4: Implement scoring** — `backend/app/scoring.py`:
```python
"""Predictive score (Probabilidade e Matchmaking source).

judge score = (Provas + Jurisprudência) / 2, each 0–10; the case score is the mean of
judge scores as a percentage. The source says "weighted average" without weights, so
every judge weighs the same until weights are specified.
"""

from collections.abc import Sequence
from typing import Protocol


class ScoredReview(Protocol):
    score_evidence: int
    score_jurisprudence: int


def judge_score(evidence: int, jurisprudence: int) -> float:
    return (evidence + jurisprudence) / 2


def probability_score(reviews: Sequence[ScoredReview]) -> float | None:
    if not reviews:
        return None
    mean = sum(judge_score(r.score_evidence, r.score_jurisprudence) for r in reviews) / len(reviews)
    return round(mean * 10, 1)
```

- [ ] **Step 5: Remove the M1 unauthenticated API**

Delete `backend/app/routers/cases.py` and `backend/tests/test_cases_api.py`. In `backend/main.py`: remove `from app.routers import cases` and `app.include_router(cases.router)`; change the CORS middleware to:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)
```

- [ ] **Step 6: Run unit tests** — `.venv/Scripts/python -m pytest -q` → all pass, no warnings.

- [ ] **Step 7: Write the migration** — `backend/migrations/versions/5d2a9c41e7b3_m3_auth_lifecycle_encryption.py`:
```python
"""m3: auth, case lifecycle, judge scores, raw_text encryption

Revision ID: 5d2a9c41e7b3
Revises: 903ef165a4e2
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.security.crypto import decrypt_text, encrypt_text

revision: str = "5d2a9c41e7b3"
down_revision: str | None = "903ef165a4e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_STATUSES = (
    "DRAFT", "AWAITING_APPROVAL", "READY_FOR_JUDGE", "EVALUATED", "IN_MEDIATION", "RESOLVED",
)
OLD_STATUSES = ("AWAITING_JUDGE", "READY_FOR_AGREEMENT", "CLOSED")


def _reencode_raw_text(transform) -> None:
    bind = op.get_bind()
    for case_id, value in bind.execute(sa.text("SELECT id, raw_text FROM cases")).all():
        bind.execute(
            sa.text("UPDATE cases SET raw_text = :value WHERE id = :id"),
            {"value": transform(value), "id": case_id},
        )


def upgrade() -> None:
    bind = op.get_bind()

    # users.password_hash — pre-existing users get an unusable hash and must be re-provisioned.
    op.add_column("users", sa.Column("password_hash", sa.String(length=255), nullable=True))
    op.execute("UPDATE users SET password_hash = '!' WHERE password_hash IS NULL")
    op.alter_column("users", "password_hash", nullable=False)

    # cases: title, score, assigned lawyer
    op.add_column(
        "cases",
        sa.Column("title", sa.String(length=200), nullable=False, server_default="Caso sem título"),
    )
    op.alter_column("cases", "title", server_default=None)
    op.add_column("cases", sa.Column("ai_probability_score", sa.Float(), nullable=True))
    op.add_column("cases", sa.Column("lawyer_id", sa.Uuid(), nullable=True))
    op.create_index(op.f("ix_cases_lawyer_id"), "cases", ["lawyer_id"], unique=False)
    op.create_foreign_key(
        op.f("fk_cases_lawyer_id_users"), "cases", "users", ["lawyer_id"], ["id"],
        ondelete="RESTRICT",
    )

    # cases.status — new lifecycle enum, old values mapped forward
    op.execute("ALTER TYPE case_status RENAME TO case_status_old")
    postgresql.ENUM(*NEW_STATUSES, name="case_status").create(bind)
    op.execute(
        """
        ALTER TABLE cases ALTER COLUMN status TYPE case_status USING (
            CASE status::text
                WHEN 'AWAITING_JUDGE' THEN 'READY_FOR_JUDGE'
                WHEN 'READY_FOR_AGREEMENT' THEN 'EVALUATED'
                WHEN 'CLOSED' THEN 'RESOLVED'
            END
        )::case_status
        """
    )
    op.execute("DROP TYPE case_status_old")

    # cases.raw_text — encrypt existing plaintext rows in place
    _reencode_raw_text(encrypt_text)

    # case_reviews — two 0–10 criteria instead of one 0–100 score; one review per judge
    op.add_column("case_reviews", sa.Column("score_evidence", sa.Integer(), nullable=True))
    op.add_column("case_reviews", sa.Column("score_jurisprudence", sa.Integer(), nullable=True))
    op.execute(
        "UPDATE case_reviews SET score_evidence = ROUND(score / 10.0), "
        "score_jurisprudence = ROUND(score / 10.0)"
    )
    op.alter_column("case_reviews", "score_evidence", nullable=False)
    op.alter_column("case_reviews", "score_jurisprudence", nullable=False)
    op.drop_constraint(op.f("ck_case_reviews_score_range"), "case_reviews", type_="check")
    op.drop_column("case_reviews", "score")
    op.create_check_constraint(
        op.f("ck_case_reviews_evidence_range"), "case_reviews", "score_evidence BETWEEN 0 AND 10"
    )
    op.create_check_constraint(
        op.f("ck_case_reviews_jurisprudence_range"),
        "case_reviews",
        "score_jurisprudence BETWEEN 0 AND 10",
    )
    op.create_unique_constraint(
        op.f("uq_case_reviews_case_id"), "case_reviews", ["case_id", "judge_id"]
    )


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_constraint(op.f("uq_case_reviews_case_id"), "case_reviews", type_="unique")
    op.drop_constraint(op.f("ck_case_reviews_jurisprudence_range"), "case_reviews", type_="check")
    op.drop_constraint(op.f("ck_case_reviews_evidence_range"), "case_reviews", type_="check")
    op.add_column("case_reviews", sa.Column("score", sa.Integer(), nullable=True))
    op.execute("UPDATE case_reviews SET score = (score_evidence + score_jurisprudence) * 5")
    op.alter_column("case_reviews", "score", nullable=False)
    op.drop_column("case_reviews", "score_jurisprudence")
    op.drop_column("case_reviews", "score_evidence")
    op.create_check_constraint(
        op.f("ck_case_reviews_score_range"), "case_reviews", "score BETWEEN 0 AND 100"
    )

    _reencode_raw_text(decrypt_text)

    op.execute("ALTER TYPE case_status RENAME TO case_status_new")
    postgresql.ENUM(*OLD_STATUSES, name="case_status").create(bind)
    op.execute(
        """
        ALTER TABLE cases ALTER COLUMN status TYPE case_status USING (
            CASE status::text
                WHEN 'EVALUATED' THEN 'READY_FOR_AGREEMENT'
                WHEN 'IN_MEDIATION' THEN 'READY_FOR_AGREEMENT'
                WHEN 'RESOLVED' THEN 'CLOSED'
                ELSE 'AWAITING_JUDGE'
            END
        )::case_status
        """
    )
    op.execute("DROP TYPE case_status_new")

    op.drop_constraint(op.f("fk_cases_lawyer_id_users"), "cases", type_="foreignkey")
    op.drop_index(op.f("ix_cases_lawyer_id"), table_name="cases")
    op.drop_column("cases", "lawyer_id")
    op.drop_column("cases", "ai_probability_score")
    op.drop_column("cases", "title")
    op.drop_column("users", "password_hash")
```

- [ ] **Step 8: Apply to Neon, round-trip, verify** (from `backend/`)
```bash
.venv/Scripts/python -m alembic upgrade head
.venv/Scripts/python -m alembic downgrade 903ef165a4e2
.venv/Scripts/python -m alembic upgrade head
.venv/Scripts/python -m alembic check
.venv/Scripts/python -m alembic current
```
Expected: no errors; `alembic check` → `No new upgrade operations detected.`; `current` → `5d2a9c41e7b3 (head)`. If `alembic check` reports differences, fix the **migration** (not the models) until clean, and record what differed.

- [ ] **Step 9: Commit**
```bash
git add -A backend/app backend/main.py backend/migrations backend/tests
git status --short   # must not list backend/.env
git commit -m "feat(db): M3 schema — lifecycle, judge criteria, lawyer, encrypted raw_text"
```

---

### Task 4: Auth API and RBAC dependencies

**Files:**
- Create: `backend/app/deps.py`, `backend/app/routers/auth.py`, `backend/tests/test_auth_api.py`
- Rewrite: `backend/app/schemas.py`
- Modify: `backend/main.py` (include auth router), `backend/tests/conftest.py` (API fixtures)

**Interfaces:**
- Consumes: `hash_password`, `verify_password`, `create_access_token`, `decode_access_token`, `cookie_secure`, `ACCESS_TOKEN_MINUTES`, `User`, `UserRole`, `get_session`.
- Produces:
  - `app.deps`: `SESSION_COOKIE = "peacelaw_session"`, `SessionDep`, `get_current_user`, `CurrentUser`, `require_role(role)`, `ClientUser`, `JudgeUser`, `LawyerUser`.
  - HTTP: `POST /api/auth/register` `{email, password}` → 201 `UserOut` + session cookie (always role CLIENT); `POST /api/auth/login` → 200 `UserOut` + cookie; `POST /api/auth/logout` → 204 (cookie cleared); `GET /api/auth/me` → 200 `UserOut` | 401.
  - `app.schemas`: `CaseText`, `CaseTitle`, `ReviewNotes`, `RegisterIn`, `LoginIn`, `UserOut`, `CaseCreate`, `RedactionCount`, `CaseSummary`, `CaseOwnerView`, `CaseCreated`, `CaseForJudge`, `CaseForLawyer`, `ReviewCreate`, `ReviewOut`, `ValidationErrorItem`, `ValidationErrorOut`.
  - conftest fixtures: `PASSWORD`, `make_user(role=CLIENT, email=None, password=PASSWORD)`, `client_factory(raise_server_exceptions=True)` (TestClient bound to the test session), `login(role=CLIENT, **kw) -> (TestClient, User)`.

- [ ] **Step 1: Add API fixtures to `backend/tests/conftest.py`**
```python
import uuid

from fastapi.testclient import TestClient

from app.db import get_session
from app.models import User, UserRole
from app.security.passwords import hash_password

PASSWORD = "senha-forte-123"


@pytest.fixture
def make_user(session):
    def _make(role=UserRole.CLIENT, email=None, password=PASSWORD):
        user = User(
            email=email or f"{role.value.lower()}-{uuid.uuid4().hex[:8]}@exemplo.com",
            role=role,
            password_hash=hash_password(password),
        )
        session.add(user)
        session.commit()
        return user

    return _make


@pytest.fixture
def client_factory(session):
    from main import app

    app.dependency_overrides[get_session] = lambda: session
    clients: list[TestClient] = []

    def _client(raise_server_exceptions: bool = True) -> TestClient:
        client = TestClient(app, raise_server_exceptions=raise_server_exceptions)
        clients.append(client)
        return client

    yield _client
    for client in clients:
        client.close()
    app.dependency_overrides.clear()


@pytest.fixture
def login(make_user, client_factory):
    def _login(role=UserRole.CLIENT, raise_server_exceptions=True, **kw):
        password = kw.pop("password", PASSWORD)
        user = make_user(role, password=password, **kw)
        client = client_factory(raise_server_exceptions)
        res = client.post("/api/auth/login", json={"email": user.email, "password": password})
        assert res.status_code == 200, res.text
        return client, user

    return _login
```

- [ ] **Step 2: Write failing tests** — `backend/tests/test_auth_api.py`:
```python
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import select

from app.deps import SESSION_COOKIE
from app.models import User, UserRole
from app.security.tokens import create_access_token
from tests.conftest import PASSWORD, TEST_JWT_SECRET


def test_register_creates_client_with_session(client_factory, session):
    client = client_factory()
    res = client.post(
        "/api/auth/register", json={"email": "  Nova@Exemplo.com ", "password": PASSWORD}
    )
    assert res.status_code == 201
    assert res.json() == {"id": res.json()["id"], "email": "nova@exemplo.com", "role": "CLIENT"}
    cookie = res.headers["set-cookie"]
    assert cookie.startswith(f"{SESSION_COOKIE}=")
    assert "HttpOnly" in cookie and "samesite=lax" in cookie.lower()
    assert client.get("/api/auth/me").json()["email"] == "nova@exemplo.com"
    stored = session.scalar(select(User).where(User.email == "nova@exemplo.com"))
    assert stored.password_hash.startswith("$argon2")


def test_register_ignores_requested_role(client_factory):
    res = client_factory().post(
        "/api/auth/register",
        json={"email": "esperto@exemplo.com", "password": PASSWORD, "role": "JUDGE"},
    )
    assert res.status_code == 201
    assert res.json()["role"] == "CLIENT"


def test_register_rejects_duplicate_email(client_factory, make_user):
    make_user(email="dup@exemplo.com")
    res = client_factory().post(
        "/api/auth/register", json={"email": "DUP@exemplo.com", "password": PASSWORD}
    )
    assert res.status_code == 409
    assert res.json() == {"detail": "E-mail já cadastrado."}


def test_register_validation_never_echoes_password(client_factory):
    res = client_factory().post(
        "/api/auth/register", json={"email": "a@exemplo.com", "password": "curta-xyz"}
    )
    assert res.status_code == 422
    assert "curta-xyz" not in res.text
    assert all(set(item) == {"field", "message"} for item in res.json()["errors"])


def test_login_and_me(login):
    client, user = login(UserRole.JUDGE)
    assert client.get("/api/auth/me").json() == {
        "id": str(user.id), "email": user.email, "role": "JUDGE",
    }


def test_wrong_password_and_unknown_email_get_the_same_answer(client_factory, make_user):
    make_user(email="x@exemplo.com")
    client = client_factory()
    wrong = client.post("/api/auth/login", json={"email": "x@exemplo.com", "password": "errada-123456"})
    unknown = client.post("/api/auth/login", json={"email": "ninguem@exemplo.com", "password": PASSWORD})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "E-mail ou senha inválidos."}
    assert "set-cookie" not in wrong.headers


def test_me_requires_a_session(client_factory):
    res = client_factory().get("/api/auth/me")
    assert res.status_code == 401
    assert res.json() == {"detail": "Não autenticado."}


def test_invalid_tokens_are_rejected(client_factory, make_user):
    user = make_user()
    client = client_factory()
    expired = jwt.encode(
        {"sub": str(user.id), "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
        TEST_JWT_SECRET,
        algorithm="HS256",
    )
    for token in (create_access_token(user.id) + "x", expired, create_access_token(uuid.uuid4())):
        client.cookies.set(SESSION_COOKIE, token)
        assert client.get("/api/auth/me").status_code == 401


def test_logout_clears_the_session(login):
    client, _ = login()
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_role_comes_from_the_database_not_the_token(login, session):
    client, user = login(UserRole.LAWYER)
    user.role = UserRole.CLIENT
    session.commit()
    assert client.get("/api/auth/me").json()["role"] == "CLIENT"
```

- [ ] **Step 3: Run to verify failure** — `.venv/Scripts/python -m pytest tests/test_auth_api.py -q` → FAIL.

- [ ] **Step 4: Rewrite `backend/app/schemas.py`**
```python
import unicodedata
import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.models import CaseStatus, UserRole

_ALLOWED_CONTROL = frozenset(chr(c) for c in (9, 10, 13))


def _reject_control_chars(value: str) -> str:
    # NUL and friends crash Postgres inserts, and the resulting driver error
    # would carry the raw text; reject them at the boundary instead.
    if any(unicodedata.category(ch) == "Cc" and ch not in _ALLOWED_CONTROL for ch in value):
        raise ValueError("O texto contém caracteres de controle não permitidos.")
    return value


CaseText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=40, max_length=20_000),
    AfterValidator(_reject_control_chars),
]
CaseTitle = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=3, max_length=200),
    AfterValidator(_reject_control_chars),
]
ReviewNotes = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=2_000),
    AfterValidator(_reject_control_chars),
]
Email = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_lower=True, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    ),
]
Score = Annotated[int, Field(ge=0, le=10)]


class RegisterIn(BaseModel):
    email: Email
    password: Annotated[str, StringConstraints(min_length=12, max_length=128)]


class LoginIn(BaseModel):
    email: Email
    password: Annotated[str, StringConstraints(min_length=1, max_length=128)]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    role: UserRole


class CaseCreate(BaseModel):
    title: CaseTitle
    text: CaseText


class RedactionCount(BaseModel):
    label: str
    count: int


class CaseSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    status: CaseStatus
    ai_probability_score: float | None
    created_at: datetime


class CaseOwnerView(CaseSummary):
    """The ONLY schema allowed to carry raw_text — returned to the case owner alone."""

    raw_text: str
    anonymized_text: str


class CaseCreated(CaseOwnerView):
    redactions: list[RedactionCount]


class CaseForJudge(BaseModel):
    """Judges see neither raw_text nor other judges' scores (no anchoring)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    anonymized_text: str
    created_at: datetime


class CaseForLawyer(BaseModel):
    """Lawyers never see raw_text."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    anonymized_text: str
    status: CaseStatus
    ai_probability_score: float | None
    created_at: datetime


class ReviewCreate(BaseModel):
    score_evidence: Score
    score_jurisprudence: Score
    notes: ReviewNotes | None = None


class ReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    case_id: uuid.UUID
    score_evidence: int
    score_jurisprudence: int
    notes: str | None
    created_at: datetime


class ValidationErrorItem(BaseModel):
    field: str
    message: str


class ValidationErrorOut(BaseModel):
    detail: str
    errors: list[ValidationErrorItem]
```

- [ ] **Step 5: Implement `backend/app/deps.py`**
```python
from collections.abc import Callable
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import User, UserRole
from app.security.tokens import decode_access_token

SESSION_COOKIE = "peacelaw_session"

SessionDep = Annotated[Session, Depends(get_session)]


def get_current_user(
    db: SessionDep,
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> User:
    user_id = decode_access_token(session_token) if session_token else None
    user = db.get(User, user_id) if user_id else None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Não autenticado.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(role: UserRole) -> Callable[[User], User]:
    def _dependency(user: CurrentUser) -> User:
        if user.role is not role:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Acesso negado.")
        return user

    return _dependency


ClientUser = Annotated[User, Depends(require_role(UserRole.CLIENT))]
JudgeUser = Annotated[User, Depends(require_role(UserRole.JUDGE))]
LawyerUser = Annotated[User, Depends(require_role(UserRole.LAWYER))]
```

- [ ] **Step 6: Implement `backend/app/routers/auth.py`**
```python
from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import cookie_secure
from app.deps import SESSION_COOKIE, CurrentUser, SessionDep
from app.models import User, UserRole
from app.schemas import LoginIn, RegisterIn, UserOut, ValidationErrorOut
from app.security.passwords import hash_password, verify_password
from app.security.tokens import ACCESS_TOKEN_MINUTES, create_access_token

router = APIRouter(
    prefix="/api/auth", tags=["auth"], responses={422: {"model": ValidationErrorOut}}
)


def _start_session(response: Response, user: User) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        create_access_token(user.id),
        max_age=ACCESS_TOKEN_MINUTES * 60,
        httponly=True,
        samesite="lax",
        secure=cookie_secure(),
        path="/",
    )


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=UserOut)
def register(payload: RegisterIn, response: Response, db: SessionDep) -> User:
    # Public sign-up always creates a CLIENT; other roles are provisioned server-side.
    if db.scalar(select(User.id).where(User.email == payload.email)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "E-mail já cadastrado.")
    user = User(
        email=payload.email, role=UserRole.CLIENT, password_hash=hash_password(payload.password)
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "E-mail já cadastrado.") from None
    db.refresh(user)
    _start_session(response, user)
    return user


@router.post("/login", response_model=UserOut)
def login(payload: LoginIn, response: Response, db: SessionDep) -> User:
    user = db.scalar(select(User).where(User.email == payload.email))
    if not verify_password(payload.password, user.password_hash if user else None):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-mail ou senha inválidos.")
    _start_session(response, user)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    response.delete_cookie(
        SESSION_COOKIE, path="/", httponly=True, samesite="lax", secure=cookie_secure()
    )


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user
```

- [ ] **Step 7: Wire it** — in `backend/main.py` add `from app.routers import auth` and `app.include_router(auth.router)` (before the `/health` route).

- [ ] **Step 8: Run all tests** — `.venv/Scripts/python -m pytest -q` → all pass, no warnings.

- [ ] **Step 9: Commit**
```bash
git add backend/app/deps.py backend/app/routers/auth.py backend/app/schemas.py backend/main.py backend/tests/conftest.py backend/tests/test_auth_api.py
git commit -m "feat(auth): JWT cookie sessions, sign-up/login/logout and RBAC dependencies"
```

---

### Task 5: Client case endpoints

**Files:**
- Create: `backend/app/routers/cases.py`, `backend/tests/test_cases_api.py`
- Modify: `backend/main.py` (include router), `backend/tests/conftest.py` (`CASE_TITLE`, `CASE_TEXT`, `approved_case` fixture)

**Interfaces:**
- Consumes: `ClientUser`, `SessionDep`, `redact_pii`, schemas from Task 4.
- Produces (HTTP, all require a CLIENT session):
  - `POST /api/cases` `{title, text}` → 201 `CaseCreated` (status `AWAITING_APPROVAL`; title and text redacted; `redactions` merged title-then-text in order of first appearance).
  - `GET /api/cases/mine` → `list[CaseSummary]` (own cases, newest first).
  - `GET /api/cases/{id}` → `CaseOwnerView` | 404 for other owners.
  - `POST /api/cases/{id}/approve` → `CaseOwnerView` (`AWAITING_APPROVAL` → `READY_FOR_JUDGE`) | 409.
  - `DELETE /api/cases/{id}` → 204 while `AWAITING_APPROVAL`/`READY_FOR_JUDGE` | 409.
  - conftest: `CASE_TITLE`, `CASE_TEXT`, fixture `approved_case() -> str` (case id, approved by a fresh client).

- [ ] **Step 1: conftest additions**
```python
CASE_TITLE = "Obra abandonada por Carlos Menezes"
CASE_TEXT = (
    "O responsável, Carlos Menezes, abandonou a obra. Paguei R$ 18.400. "
    "Meu CPF é 123.456.789-00 e meu telefone é (11) 98765-4321."
)
PII = ("Carlos Menezes", "18.400", "123.456.789-00", "98765-4321")


def assert_no_pii(text: str) -> None:
    for secret in PII:
        assert secret not in text


@pytest.fixture
def approved_case(login):
    def _make() -> str:
        client, _ = login(UserRole.CLIENT)
        case_id = client.post("/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT}).json()["id"]
        assert client.post(f"/api/cases/{case_id}/approve").status_code == 200
        return case_id

    return _make
```

- [ ] **Step 2: Write failing tests** — `backend/tests/test_cases_api.py`:
```python
import logging
import uuid

from sqlalchemy.exc import DBAPIError

from app.models import Case, CaseStatus, UserRole
from main import app
from tests.conftest import CASE_TEXT, CASE_TITLE, PASSWORD, assert_no_pii

SUMMARY_KEYS = {"id", "title", "status", "ai_probability_score", "created_at"}


def _create(client):
    return client.post("/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT})


def test_creating_a_case_requires_a_session(client_factory):
    assert _create(client_factory()).status_code == 401


def test_only_clients_create_cases(login):
    for role in (UserRole.JUDGE, UserRole.LAWYER, UserRole.ADMIN):
        client, _ = login(role)
        res = _create(client)
        assert res.status_code == 403
        assert res.json() == {"detail": "Acesso negado."}


def test_create_redacts_title_and_text_and_awaits_approval(login, session):
    client, user = login()
    res = _create(client)
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "AWAITING_APPROVAL"
    assert body["title"] == "Obra abandonada por [NOME]"
    assert body["anonymized_text"] == (
        "O responsável, [NOME], abandonou a obra. Paguei [VALOR]. "
        "Meu CPF é [CPF] e meu telefone é [TELEFONE]."
    )
    assert body["raw_text"] == CASE_TEXT  # owner view
    assert body["ai_probability_score"] is None
    assert body["redactions"] == [
        {"label": "NOME", "count": 2},
        {"label": "VALOR", "count": 1},
        {"label": "CPF", "count": 1},
        {"label": "TELEFONE", "count": 1},
    ]
    assert session.get(Case, uuid.UUID(body["id"])).client_id == user.id


def test_mine_lists_only_own_cases_without_texts(login):
    alice, _ = login()
    bob, _ = login()
    mine = _create(alice).json()["id"]
    _create(bob)
    res = alice.get("/api/cases/mine")
    assert [c["id"] for c in res.json()] == [mine]
    assert set(res.json()[0]) == SUMMARY_KEYS


def test_owner_view_is_private(login):
    alice, _ = login()
    bob, _ = login()
    case_id = _create(alice).json()["id"]
    assert alice.get(f"/api/cases/{case_id}").json()["raw_text"] == CASE_TEXT
    res = bob.get(f"/api/cases/{case_id}")
    assert res.status_code == 404
    assert res.json() == {"detail": "Caso não encontrado."}


def test_approve_sends_case_to_judges_once(login):
    client, _ = login()
    case_id = _create(client).json()["id"]
    res = client.post(f"/api/cases/{case_id}/approve")
    assert res.status_code == 200
    assert res.json()["status"] == "READY_FOR_JUDGE"
    again = client.post(f"/api/cases/{case_id}/approve")
    assert again.status_code == 409
    assert again.json() == {"detail": "Transição de status inválida."}


def test_other_clients_cannot_approve(login):
    alice, _ = login()
    bob, _ = login()
    case_id = _create(alice).json()["id"]
    assert bob.post(f"/api/cases/{case_id}/approve").status_code == 404


def test_delete_before_evaluation(login, session):
    client, _ = login()
    case_id = _create(client).json()["id"]
    assert client.delete(f"/api/cases/{case_id}").status_code == 204
    assert client.get(f"/api/cases/{case_id}").status_code == 404
    assert session.get(Case, uuid.UUID(case_id)) is None


def test_delete_is_refused_after_evaluation(login, session):
    client, _ = login()
    case_id = _create(client).json()["id"]
    case = session.get(Case, uuid.UUID(case_id))
    case.status = CaseStatus.EVALUATED
    session.commit()
    res = client.delete(f"/api/cases/{case_id}")
    assert res.status_code == 409
    assert res.json() == {"detail": "Este caso não pode mais ser excluído."}


def test_validation_errors_never_echo_the_report(login):
    client, _ = login()
    oversized = "Meu CPF é 123.456.789-00. " * 1_000
    for payload in ({"title": "ok", "text": "curto 123.456.789-00"}, {"title": CASE_TITLE, "text": oversized}):
        res = client.post("/api/cases", json=payload)
        assert res.status_code == 422
        assert "123.456.789-00" not in res.text
        assert all(set(item) == {"field", "message"} for item in res.json()["errors"])


def test_control_characters_are_rejected(login):
    client, _ = login()
    res = client.post("/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT + "\u0000"})
    assert res.status_code == 422
    assert "123.456.789-00" not in res.text


def test_commit_failure_never_leaks_the_report(make_user, client_factory, session, caplog):
    user = make_user()
    client = client_factory(raise_server_exceptions=False)
    assert client.post("/api/auth/login", json={"email": user.email, "password": PASSWORD}).status_code == 200

    def failing_commit():
        raise DBAPIError("INSERT INTO cases ...", (CASE_TEXT,), Exception("boom"), hide_parameters=True)

    session.commit = failing_commit
    with caplog.at_level(logging.DEBUG):
        res = _create(client)
    assert res.status_code == 500
    assert_no_pii(res.text)
    assert_no_pii(caplog.text)


def test_openapi_documents_the_sanitized_422_shape():
    spec = app.openapi()
    schema = spec["paths"]["/api/cases"]["post"]["responses"]["422"]["content"]["application/json"]["schema"]
    assert schema["$ref"].endswith("/ValidationErrorOut")
```

- [ ] **Step 3: Run to verify failure** — `.venv/Scripts/python -m pytest tests/test_cases_api.py -q` → FAIL (404s: router missing).

- [ ] **Step 4: Implement** — `backend/app/routers/cases.py`:
```python
import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.deps import ClientUser, SessionDep
from app.models import Case, CaseStatus, User
from app.privacy.redaction import redact_pii
from app.schemas import (
    CaseCreate,
    CaseCreated,
    CaseOwnerView,
    CaseSummary,
    RedactionCount,
    ValidationErrorOut,
)

router = APIRouter(
    prefix="/api/cases", tags=["cases"], responses={422: {"model": ValidationErrorOut}}
)

DELETABLE = frozenset({CaseStatus.AWAITING_APPROVAL, CaseStatus.READY_FOR_JUDGE})


def _owned_case(db: SessionDep, case_id: uuid.UUID, client: User) -> Case:
    case = db.get(Case, case_id)
    if case is None or case.client_id != client.id:
        # 404 rather than 403: never confirm that someone else's case exists.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Caso não encontrado.")
    return case


@router.post("", status_code=status.HTTP_201_CREATED, response_model=CaseCreated)
def create_case(payload: CaseCreate, client: ClientUser, db: SessionDep) -> CaseCreated:
    title = redact_pii(payload.title)
    text = redact_pii(payload.text)
    case = Case(
        client_id=client.id,
        title=title.text,
        raw_text=payload.text,
        anonymized_text=text.text,
        status=CaseStatus.AWAITING_APPROVAL,
    )
    db.add(case)
    db.commit()
    db.refresh(case)

    counts: dict[str, int] = {}
    for source in (title.counts, text.counts):
        for label, count in source.items():
            counts[label] = counts.get(label, 0) + count
    return CaseCreated(
        **CaseOwnerView.model_validate(case).model_dump(),
        redactions=[RedactionCount(label=k, count=v) for k, v in counts.items()],
    )


@router.get("/mine", response_model=list[CaseSummary])
def my_cases(client: ClientUser, db: SessionDep) -> list[Case]:
    stmt = (
        select(Case)
        .where(Case.client_id == client.id)
        .order_by(Case.created_at.desc(), Case.id)
    )
    return list(db.scalars(stmt))


@router.get("/{case_id}", response_model=CaseOwnerView)
def get_my_case(case_id: uuid.UUID, client: ClientUser, db: SessionDep) -> Case:
    return _owned_case(db, case_id, client)


@router.post("/{case_id}/approve", response_model=CaseOwnerView)
def approve_case(case_id: uuid.UUID, client: ClientUser, db: SessionDep) -> Case:
    case = _owned_case(db, case_id, client)
    if case.status is not CaseStatus.AWAITING_APPROVAL:
        raise HTTPException(status.HTTP_409_CONFLICT, "Transição de status inválida.")
    case.status = CaseStatus.READY_FOR_JUDGE
    db.commit()
    db.refresh(case)
    return case


@router.delete("/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_case(case_id: uuid.UUID, client: ClientUser, db: SessionDep) -> None:
    case = _owned_case(db, case_id, client)
    if case.status not in DELETABLE:
        raise HTTPException(status.HTTP_409_CONFLICT, "Este caso não pode mais ser excluído.")
    db.delete(case)
    db.commit()
```
Wire in `backend/main.py`: `from app.routers import auth, cases` and `app.include_router(cases.router)`.

- [ ] **Step 5: Run all tests** → all pass, no warnings.

- [ ] **Step 6: Commit**
```bash
git add backend/app/routers/cases.py backend/main.py backend/tests/conftest.py backend/tests/test_cases_api.py
git commit -m "feat(api): client case lifecycle — create, approve, list, delete"
```

---

### Task 6: Judge and lawyer endpoints

**Files:**
- Create: `backend/app/routers/judge.py`, `backend/app/routers/lawyer.py`, `backend/tests/test_judge_api.py`, `backend/tests/test_lawyer_api.py`
- Modify: `backend/main.py`, `backend/tests/conftest.py` (`evaluated_case` fixture)

**Interfaces:**
- Consumes: `JudgeUser`, `LawyerUser`, `SessionDep`, `probability_score`, `redact_pii`, `approved_case`.
- Produces (HTTP):
  - `GET /api/judge/queue` (JUDGE) → `list[CaseForJudge]`: status `READY_FOR_JUDGE` or `EVALUATED`, not yet reviewed by this judge, oldest first.
  - `POST /api/cases/{id}/reviews` (JUDGE) `{score_evidence, score_jurisprudence, notes?}` → 201 `ReviewOut`; recomputes `ai_probability_score`; status → `EVALUATED`. 404 if missing or not yet approved; 409 if already reviewed by this judge or the case is in mediation/resolved.
  - `GET /api/lawyer/board` (LAWYER) → `list[CaseForLawyer]`: all `EVALUATED` + this lawyer's `IN_MEDIATION`/`RESOLVED`, highest score first.
  - `POST /api/cases/{id}/match` (LAWYER) → `CaseForLawyer` (`EVALUATED` & unassigned → `IN_MEDIATION`, `lawyer_id = me`, atomic) | 404 not evaluated | 409 already taken.
  - `POST /api/cases/{id}/resolve` (LAWYER) → `CaseForLawyer` (`IN_MEDIATION` & mine → `RESOLVED`) | 404 not mine | 409 wrong state.
  - conftest: `evaluated_case(evidence=8, jurisprudence=6) -> str`.

- [ ] **Step 1: conftest addition**
```python
@pytest.fixture
def evaluated_case(login, approved_case):
    def _make(evidence: int = 8, jurisprudence: int = 6) -> str:
        case_id = approved_case()
        judge, _ = login(UserRole.JUDGE)
        res = judge.post(
            f"/api/cases/{case_id}/reviews",
            json={"score_evidence": evidence, "score_jurisprudence": jurisprudence},
        )
        assert res.status_code == 201, res.text
        return case_id

    return _make
```

- [ ] **Step 2: Write failing tests**

`backend/tests/test_judge_api.py`:
```python
import uuid

from app.models import Case, CaseStatus, UserRole
from tests.conftest import CASE_TEXT, CASE_TITLE, assert_no_pii

JUDGE_KEYS = {"id", "title", "anonymized_text", "created_at"}
REVIEW = {"score_evidence": 8, "score_jurisprudence": 6, "notes": "Prova documental robusta."}


def test_queue_is_for_judges_only(login):
    for role in (UserRole.CLIENT, UserRole.LAWYER):
        client, _ = login(role)
        assert client.get("/api/judge/queue").status_code == 403


def test_queue_shows_approved_cases_only_and_never_raw_text(login, approved_case):
    approved = approved_case()
    client, _ = login()
    client.post("/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT})  # not approved
    judge, _ = login(UserRole.JUDGE)
    res = judge.get("/api/judge/queue")
    assert [c["id"] for c in res.json()] == [approved]
    assert set(res.json()[0]) == JUDGE_KEYS
    assert_no_pii(res.text)


def test_review_scores_the_case_and_leaves_the_queue(login, approved_case, session):
    case_id = approved_case()
    judge, _ = login(UserRole.JUDGE)
    res = judge.post(f"/api/cases/{case_id}/reviews", json=REVIEW)
    assert res.status_code == 201
    assert {k: res.json()[k] for k in REVIEW} == REVIEW
    case = session.get(Case, uuid.UUID(case_id))
    session.refresh(case)
    assert case.status is CaseStatus.EVALUATED
    assert case.ai_probability_score == 70.0
    assert judge.get("/api/judge/queue").json() == []


def test_more_judges_refine_the_average(login, approved_case, session):
    case_id = approved_case()
    first, _ = login(UserRole.JUDGE)
    second, _ = login(UserRole.JUDGE)
    first.post(f"/api/cases/{case_id}/reviews", json={"score_evidence": 8, "score_jurisprudence": 6})
    assert [c["id"] for c in second.get("/api/judge/queue").json()] == [case_id]
    second.post(f"/api/cases/{case_id}/reviews", json={"score_evidence": 10, "score_jurisprudence": 8})
    case = session.get(Case, uuid.UUID(case_id))
    session.refresh(case)
    assert case.ai_probability_score == 80.0


def test_a_judge_reviews_a_case_once(login, approved_case):
    case_id = approved_case()
    judge, _ = login(UserRole.JUDGE)
    judge.post(f"/api/cases/{case_id}/reviews", json=REVIEW)
    res = judge.post(f"/api/cases/{case_id}/reviews", json=REVIEW)
    assert res.status_code == 409
    assert res.json() == {"detail": "Você já avaliou este caso."}


def test_scores_must_be_between_0_and_10(login, approved_case):
    case_id = approved_case()
    judge, _ = login(UserRole.JUDGE)
    res = judge.post(f"/api/cases/{case_id}/reviews", json={"score_evidence": 11, "score_jurisprudence": 5})
    assert res.status_code == 422


def test_unapproved_cases_are_invisible_to_judges(login):
    client, _ = login()
    case_id = client.post("/api/cases", json={"title": CASE_TITLE, "text": CASE_TEXT}).json()["id"]
    judge, _ = login(UserRole.JUDGE)
    res = judge.post(f"/api/cases/{case_id}/reviews", json=REVIEW)
    assert res.status_code == 404
    assert res.json() == {"detail": "Caso não encontrado."}


def test_cases_in_mediation_accept_no_more_reviews(login, approved_case, session):
    case_id = approved_case()
    case = session.get(Case, uuid.UUID(case_id))
    case.status = CaseStatus.IN_MEDIATION
    session.commit()
    judge, _ = login(UserRole.JUDGE)
    res = judge.post(f"/api/cases/{case_id}/reviews", json=REVIEW)
    assert res.status_code == 409
    assert res.json() == {"detail": "Este caso não aceita mais avaliações."}


def test_review_notes_are_redacted(login, approved_case):
    case_id = approved_case()
    judge, _ = login(UserRole.JUDGE)
    res = judge.post(
        f"/api/cases/{case_id}/reviews",
        json={"score_evidence": 5, "score_jurisprudence": 5, "notes": "Falei com Carlos Menezes, CPF 123.456.789-00."},
    )
    assert res.json()["notes"] == "Falei com [NOME], CPF [CPF]."
```

`backend/tests/test_lawyer_api.py`:
```python
import uuid

from app.models import Case, CaseStatus, UserRole
from tests.conftest import assert_no_pii

LAWYER_KEYS = {"id", "title", "anonymized_text", "status", "ai_probability_score", "created_at"}


def test_board_is_for_lawyers_only(login):
    for role in (UserRole.CLIENT, UserRole.JUDGE):
        client, _ = login(role)
        assert client.get("/api/lawyer/board").status_code == 403


def test_board_lists_evaluated_cases_without_raw_text(login, approved_case, evaluated_case):
    approved_case()  # not evaluated yet → not on the board
    evaluated = evaluated_case()
    lawyer, _ = login(UserRole.LAWYER)
    res = lawyer.get("/api/lawyer/board")
    assert [c["id"] for c in res.json()] == [evaluated]
    assert set(res.json()[0]) == LAWYER_KEYS
    assert res.json()[0]["ai_probability_score"] == 70.0
    assert_no_pii(res.text)


def test_board_orders_by_score(login, evaluated_case):
    low = evaluated_case(3, 3)
    high = evaluated_case(9, 9)
    lawyer, _ = login(UserRole.LAWYER)
    assert [c["id"] for c in lawyer.get("/api/lawyer/board").json()] == [high, low]


def test_match_moves_case_to_mediation(login, evaluated_case, session):
    case_id = evaluated_case()
    lawyer, me = login(UserRole.LAWYER)
    res = lawyer.post(f"/api/cases/{case_id}/match")
    assert res.status_code == 200
    assert res.json()["status"] == "IN_MEDIATION"
    case = session.get(Case, uuid.UUID(case_id))
    session.refresh(case)
    assert case.lawyer_id == me.id


def test_a_case_is_matched_once(login, evaluated_case):
    case_id = evaluated_case()
    first, _ = login(UserRole.LAWYER)
    second, _ = login(UserRole.LAWYER)
    first.post(f"/api/cases/{case_id}/match")
    res = second.post(f"/api/cases/{case_id}/match")
    assert res.status_code == 409
    assert res.json() == {"detail": "Este caso já está em mediação."}
    assert second.get("/api/lawyer/board").json() == []


def test_unevaluated_cases_cannot_be_matched(login, approved_case):
    case_id = approved_case()
    lawyer, _ = login(UserRole.LAWYER)
    res = lawyer.post(f"/api/cases/{case_id}/match")
    assert res.status_code == 404


def test_resolve_by_the_assigned_lawyer(login, evaluated_case):
    case_id = evaluated_case()
    lawyer, _ = login(UserRole.LAWYER)
    lawyer.post(f"/api/cases/{case_id}/match")
    res = lawyer.post(f"/api/cases/{case_id}/resolve")
    assert res.status_code == 200
    assert res.json()["status"] == "RESOLVED"
    assert [c["status"] for c in lawyer.get("/api/lawyer/board").json()] == ["RESOLVED"]
    again = lawyer.post(f"/api/cases/{case_id}/resolve")
    assert again.status_code == 409
    assert again.json() == {"detail": "Transição de status inválida."}


def test_other_lawyers_cannot_resolve(login, evaluated_case):
    case_id = evaluated_case()
    owner, _ = login(UserRole.LAWYER)
    intruder, _ = login(UserRole.LAWYER)
    owner.post(f"/api/cases/{case_id}/match")
    res = intruder.post(f"/api/cases/{case_id}/resolve")
    assert res.status_code == 404
    assert res.json() == {"detail": "Caso não encontrado."}
```

- [ ] **Step 3: Run to verify failure** — FAIL (routes missing).

- [ ] **Step 4: Implement** — `backend/app/routers/judge.py`:
```python
import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.deps import JudgeUser, SessionDep
from app.models import Case, CaseReview, CaseStatus
from app.privacy.redaction import redact_pii
from app.schemas import CaseForJudge, ReviewCreate, ReviewOut, ValidationErrorOut
from app.scoring import probability_score

router = APIRouter(prefix="/api", tags=["judge"], responses={422: {"model": ValidationErrorOut}})

REVIEWABLE = (CaseStatus.READY_FOR_JUDGE, CaseStatus.EVALUATED)
NOT_YET_APPROVED = (CaseStatus.DRAFT, CaseStatus.AWAITING_APPROVAL)


@router.get("/judge/queue", response_model=list[CaseForJudge])
def queue(judge: JudgeUser, db: SessionDep) -> list[Case]:
    reviewed_by_me = select(CaseReview.case_id).where(CaseReview.judge_id == judge.id)
    stmt = (
        select(Case)
        .where(Case.status.in_(REVIEWABLE), Case.id.not_in(reviewed_by_me))
        .order_by(Case.created_at, Case.id)
    )
    return list(db.scalars(stmt))


@router.post(
    "/cases/{case_id}/reviews", status_code=status.HTTP_201_CREATED, response_model=ReviewOut
)
def submit_review(
    case_id: uuid.UUID, payload: ReviewCreate, judge: JudgeUser, db: SessionDep
) -> CaseReview:
    case = db.get(Case, case_id)
    if case is None or case.status in NOT_YET_APPROVED:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Caso não encontrado.")
    if case.status not in REVIEWABLE:
        raise HTTPException(status.HTTP_409_CONFLICT, "Este caso não aceita mais avaliações.")
    if any(review.judge_id == judge.id for review in case.reviews):
        raise HTTPException(status.HTTP_409_CONFLICT, "Você já avaliou este caso.")

    review = CaseReview(
        judge_id=judge.id,
        score_evidence=payload.score_evidence,
        score_jurisprudence=payload.score_jurisprudence,
        notes=redact_pii(payload.notes).text if payload.notes else None,
    )
    case.reviews.append(review)
    case.ai_probability_score = probability_score(case.reviews)
    case.status = CaseStatus.EVALUATED
    try:
        db.commit()
    except IntegrityError:  # concurrent double submit hits UNIQUE(case_id, judge_id)
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Você já avaliou este caso.") from None
    db.refresh(review)
    return review
```

`backend/app/routers/lawyer.py`:
```python
import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, or_, select, update

from app.deps import LawyerUser, SessionDep
from app.models import Case, CaseStatus
from app.schemas import CaseForLawyer

router = APIRouter(prefix="/api", tags=["lawyer"])

NOT_YET_EVALUATED = (CaseStatus.DRAFT, CaseStatus.AWAITING_APPROVAL, CaseStatus.READY_FOR_JUDGE)


@router.get("/lawyer/board", response_model=list[CaseForLawyer])
def board(lawyer: LawyerUser, db: SessionDep) -> list[Case]:
    stmt = (
        select(Case)
        .where(
            or_(
                Case.status == CaseStatus.EVALUATED,
                and_(
                    Case.lawyer_id == lawyer.id,
                    Case.status.in_((CaseStatus.IN_MEDIATION, CaseStatus.RESOLVED)),
                ),
            )
        )
        .order_by(Case.ai_probability_score.desc().nulls_last(), Case.created_at, Case.id)
    )
    return list(db.scalars(stmt))


@router.post("/cases/{case_id}/match", response_model=CaseForLawyer)
def match(case_id: uuid.UUID, lawyer: LawyerUser, db: SessionDep) -> Case:
    # Conditional UPDATE: two lawyers clicking at once cannot both win.
    result = db.execute(
        update(Case)
        .where(Case.id == case_id, Case.status == CaseStatus.EVALUATED, Case.lawyer_id.is_(None))
        .values(status=CaseStatus.IN_MEDIATION, lawyer_id=lawyer.id)
    )
    if result.rowcount == 0:
        db.rollback()
        case = db.get(Case, case_id)
        if case is None or case.status in NOT_YET_EVALUATED:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Caso não encontrado.")
        raise HTTPException(status.HTTP_409_CONFLICT, "Este caso já está em mediação.")
    db.commit()
    case = db.get(Case, case_id)
    db.refresh(case)
    return case


@router.post("/cases/{case_id}/resolve", response_model=CaseForLawyer)
def resolve(case_id: uuid.UUID, lawyer: LawyerUser, db: SessionDep) -> Case:
    case = db.get(Case, case_id)
    if case is None or case.lawyer_id != lawyer.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Caso não encontrado.")
    if case.status is not CaseStatus.IN_MEDIATION:
        raise HTTPException(status.HTTP_409_CONFLICT, "Transição de status inválida.")
    case.status = CaseStatus.RESOLVED
    db.commit()
    db.refresh(case)
    return case
```
Wire both routers in `backend/main.py` (`from app.routers import auth, cases, judge, lawyer`; include all four).

- [ ] **Step 5: Run all tests** → all pass, no warnings.

- [ ] **Step 6: Commit**
```bash
git add backend/app/routers/judge.py backend/app/routers/lawyer.py backend/main.py backend/tests/conftest.py backend/tests/test_judge_api.py backend/tests/test_lawyer_api.py
git commit -m "feat(api): judge reviews with predictive score; lawyer match and resolve"
```

---

### Task 7: Demo accounts script and end-to-end smoke against Neon

**Files:**
- Create: `backend/scripts/__init__.py` (empty), `backend/scripts/seed_demo_users.py`, `backend/README.md`

**Interfaces:**
- Produces: `python -m scripts.seed_demo_users` (from `backend/`) creating `cliente.demo@peacelaw.dev` (CLIENT), `juiz.demo@peacelaw.dev` (JUDGE), `advogado.demo@peacelaw.dev` (LAWYER) with random passwords printed once; existing accounts untouched.

- [ ] **Step 1: Implement** — `backend/scripts/seed_demo_users.py`:
```python
"""Create demo CLIENT, JUDGE and LAWYER accounts (development only).

Usage, from backend/:  .venv/Scripts/python -m scripts.seed_demo_users
Each new account's generated password is printed once; existing accounts are untouched.
JUDGE and LAWYER accounts can only be created server-side (public sign-up is CLIENT-only).
"""

import secrets

from sqlalchemy import select

from app.db import _session_factory
from app.models import User, UserRole
from app.security.passwords import hash_password

DEMO_ACCOUNTS = (
    ("cliente.demo@peacelaw.dev", UserRole.CLIENT),
    ("juiz.demo@peacelaw.dev", UserRole.JUDGE),
    ("advogado.demo@peacelaw.dev", UserRole.LAWYER),
)


def main() -> None:
    with _session_factory()() as db:
        for email, role in DEMO_ACCOUNTS:
            if db.scalar(select(User.id).where(User.email == email)) is not None:
                print(f"{role.value:<7} {email}  (já existe; senha inalterada)")
                continue
            password = secrets.token_urlsafe(12)
            db.add(User(email=email, role=role, password_hash=hash_password(password)))
            db.commit()
            print(f"{role.value:<7} {email}  senha: {password}")


if __name__ == "__main__":
    main()
```

`backend/README.md`:
```markdown
# PeaceLaw API

FastAPI + SQLAlchemy + Neon Postgres.

## Setup
1. `python -m venv .venv && .venv/Scripts/python -m pip install -r requirements-dev.txt`
2. Copy `.env.example` to `.env` and fill `DATABASE_URL`, `JWT_SECRET`, `RAW_TEXT_KEYS`.
3. `.venv/Scripts/python -m alembic upgrade head`
4. Demo accounts: `.venv/Scripts/python -m scripts.seed_demo_users` (prints passwords once).

## Run
`.venv/Scripts/python -m uvicorn main:app --reload --port 8000` — docs at `/docs`.

## Test
`.venv/Scripts/python -m pytest` (in-memory SQLite; never touches Neon).

## Privacy by Design
- Case title, report and judge notes are redacted before storage for third parties.
- `raw_text` is encrypted at rest (Fernet, `RAW_TEXT_KEYS`) and only returned to its owner.
- Sessions: JWT in an httpOnly, SameSite=Lax cookie; role re-read from the DB per request.
```

- [ ] **Step 2: Smoke test against Neon** (from `backend/`) — do NOT run the seed script here (the controller runs it so the passwords reach the user); instead run an isolated flow with throwaway users and clean up:
```bash
.venv/Scripts/python - <<'PY'
import secrets
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from app.db import _session_factory
from app.models import Case, User, UserRole
from app.security.passwords import hash_password
from main import app

tag = secrets.token_hex(4)
pw = secrets.token_urlsafe(12)
emails = {r: f"smoke-{tag}-{r.value.lower()}@peacelaw.dev" for r in (UserRole.JUDGE, UserRole.LAWYER)}
with _session_factory()() as db:
    for role, email in emails.items():
        db.add(User(email=email, role=role, password_hash=hash_password(pw)))
    db.commit()
client, judge, lawyer = TestClient(app), TestClient(app), TestClient(app)
assert client.post("/api/auth/register", json={"email": f"smoke-{tag}-client@peacelaw.dev", "password": pw}).status_code == 201
case = client.post("/api/cases", json={"title": "Teste de fumaça", "text": "Meu CPF é 123.456.789-00 e a obra parou há três meses, sem resposta."}).json()
assert client.post(f"/api/cases/{case['id']}/approve").json()["status"] == "READY_FOR_JUDGE"
assert judge.post("/api/auth/login", json={"email": emails[UserRole.JUDGE], "password": pw}).status_code == 200
assert judge.post(f"/api/cases/{case['id']}/reviews", json={"score_evidence": 9, "score_jurisprudence": 8}).status_code == 201
assert lawyer.post("/api/auth/login", json={"email": emails[UserRole.LAWYER], "password": pw}).status_code == 200
assert lawyer.post(f"/api/cases/{case['id']}/match").json()["status"] == "IN_MEDIATION"
final = lawyer.post(f"/api/cases/{case['id']}/resolve").json()
assert final["status"] == "RESOLVED" and final["ai_probability_score"] == 85.0 and "raw_text" not in final
with _session_factory()() as db:
    raw = db.execute(__import__("sqlalchemy").text("SELECT raw_text FROM cases WHERE id = :id"), {"id": case["id"]}).scalar_one()
    assert "123.456.789-00" not in raw
    db.execute(delete(Case).where(Case.id == case["id"]))
    db.execute(delete(User).where(User.email.like(f"smoke-{tag}-%")))
    db.commit()
print("smoke ok")
PY
```
Expected: `smoke ok`.

- [ ] **Step 3: Full suite + check** — `.venv/Scripts/python -m pytest -q` (all pass, no warnings) and `.venv/Scripts/python -m alembic check` (clean).

- [ ] **Step 4: Commit**
```bash
git add backend/scripts backend/README.md
git commit -m "chore(backend): demo account script and README"
```

---

## Done — M3a

Hand off to M3b (frontend pages). The controller runs `scripts.seed_demo_users` once and passes the printed passwords to the user at the final STOP.
