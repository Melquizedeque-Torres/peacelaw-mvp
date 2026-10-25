# M1 — Backend & Neon Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A FastAPI backend wired to Neon Postgres with User/Case/CaseReview models, an Alembic migration applied, real PII redaction, and `/api/cases` endpoints that never leak `raw_text`.

**Architecture:** `backend/app` package: `config` (env) → `db` (lazy engine, session dependency) → `models` (SQLAlchemy 2.0 typed) → `privacy/redaction` (pure function) → `schemas` (Pydantic, public views only) → `routers/cases`. `backend/main.py` assembles the app. Tests use in-memory SQLite via dependency override; the migration targets Neon.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2.0, Pydantic v2, psycopg 3, Alembic, python-dotenv, pytest, httpx.

**Spec:** `docs/superpowers/specs/2026-10-14-peacelaw-mvp-design.md`

## Global Constraints

- Repo root is `c:\Users\mellq\PeaceLaw`; backend lives in `backend/`. All backend commands run from `backend/`.
- Windows + Git Bash: the venv interpreter is `.venv/Scripts/python`. Always invoke tools as `.venv/Scripts/python -m <tool>`.
- `raw_text` must never appear in any Pydantic response schema or API response.
- Never print, log, commit, or echo the contents of `backend/.env` (it holds the Neon password). Only `backend/.env.example` is committed.
- User-facing error messages are in Portuguese (pt-BR); code identifiers in English.
- Minimum case text length: 40 characters (matches the client wizard `MIN = 40`).
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

---

### Task 1: Repo foundation and backend skeleton

**Files:**
- Create: `.gitignore`, `docs/prd.md`, `.cursorrules`, `CLAUDE.md`
- Create: `backend/requirements.txt`, `backend/requirements-dev.txt`, `backend/pytest.ini`, `backend/.env.example`
- Create: `backend/app/__init__.py` (empty), `backend/app/config.py`
- Test: `backend/tests/__init__.py` (empty), `backend/tests/test_config.py`

**Interfaces:**
- Produces: `app.config.get_database_url() -> str` — reads `DATABASE_URL` (loading `backend/.env` via python-dotenv), rewrites a `postgresql://` prefix to `postgresql+psycopg://`, raises `RuntimeError` when missing.

- [ ] **Step 1: Write root files**

`.gitignore`:
```gitignore
# Python
.venv/
__pycache__/
*.pyc
.pytest_cache/

# Node
node_modules/
.next/
out/

# Env / secrets
.env
.env.*
!.env.example

# OS / editor
.DS_Store
Thumbs.db
```

`docs/prd.md`:
```markdown
# PeaceLaw — Product Requirements (MVP)

## Core concept
Online Dispute Resolution (ODR) platform with AI-driven probability scoring
and lawyer matchmaking. A client describes a dispute; the platform estimates
the chance of a favorable outcome from similar decisions, a judge evaluates
the anonymized case, and lawyers pick up mediation opportunities.

## Actors
| Actor | UI | Responsibilities |
|---|---|---|
| Client (Demandante) | Wizard | Submits the case report and documents, reviews what was anonymized, sees the probability score. |
| Judge (Avaliador) | Split-view (accessible) | Reads the anonymized case, records a score (0–100) and notes. |
| Lawyer (Solucionador) | Kanban | Browses anonymized opportunities, assumes cases, closes agreements or escalates to arbitration. |
| Admin | — | Platform operations. |

## Case lifecycle
`AWAITING_JUDGE` → `READY_FOR_AGREEMENT` → `CLOSED`

## Privacy by Design (non-negotiable)
- ALL case texts/documents pass through a PII redaction layer before being
  saved to the database for third-party viewing.
- `raw_text` is visible only to the case owner. It is never returned by any
  API consumed by judges or lawyers.
- Third parties only ever see `anonymized_text`.
- PII covered by the MVP redaction layer: e-mail, CPF, CNPJ, phone, CEP,
  street address, company names (Ltda/S.A./EIRELI/ME), person names.
```

`.cursorrules` and `CLAUDE.md` (identical content):
```text
You are a Senior Dev. Stack: Next.js (Tailwind/Shadcn) + Python (FastAPI/SQLAlchemy). Always prioritize Privacy by Design. Read /docs/prd.md before architectural decisions. Never output placeholder code for security features.
```

- [ ] **Step 2: Write backend dependency and config files**

`backend/requirements.txt`:
```text
fastapi>=0.115
uvicorn[standard]>=0.32
sqlalchemy>=2.0.36
pydantic>=2.9
psycopg[binary]>=3.2
alembic>=1.14
python-dotenv>=1.0
```

`backend/requirements-dev.txt`:
```text
-r requirements.txt
pytest>=8.3
httpx>=0.28
```

`backend/pytest.ini`:
```ini
[pytest]
pythonpath = .
testpaths = tests
```

`backend/.env.example`:
```dotenv
# Neon connection string (Neon console → Connect). Copy this file to .env.
DATABASE_URL=postgresql://USER:PASSWORD@HOST/peacelaw?sslmode=require&channel_binding=require
```

- [ ] **Step 3: Create the venv and install**

Run (from `backend/`):
```bash
python -m venv .venv
.venv/Scripts/python -m pip install --upgrade pip
.venv/Scripts/python -m pip install -r requirements-dev.txt
```
Expected: installs complete without errors.

- [ ] **Step 4: Write the failing test**

`backend/tests/test_config.py`:
```python
import pytest

from app.config import get_database_url


def test_rewrites_plain_postgres_scheme_to_psycopg(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@host/db?sslmode=require")
    assert get_database_url() == "postgresql+psycopg://u:p@host/db?sslmode=require"


def test_keeps_explicit_driver(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    assert get_database_url() == "sqlite+pysqlite:///:memory:"


def test_missing_url_raises(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        get_database_url()
```

- [ ] **Step 5: Run it to verify it fails**

Run: `.venv/Scripts/python -m pytest tests/test_config.py -v`
Expected: FAIL / collection error — `ModuleNotFoundError: No module named 'app.config'`.

- [ ] **Step 6: Implement**

`backend/app/config.py`:
```python
import os

from dotenv import load_dotenv

load_dotenv()


def get_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL não definido. Copie backend/.env.example para backend/.env."
        )
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url
```

Note: `load_dotenv()` runs once at import; the tests monkeypatch `os.environ` afterwards, so they behave the same whether or not `backend/.env` exists.

- [ ] **Step 7: Run tests to verify they pass**

Run: `.venv/Scripts/python -m pytest -v`
Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git add .gitignore docs/prd.md .cursorrules CLAUDE.md backend/requirements.txt backend/requirements-dev.txt backend/pytest.ini backend/.env.example backend/app/__init__.py backend/app/config.py backend/tests/__init__.py backend/tests/test_config.py
git commit -m "chore: bootstrap repo rules, PRD and backend config"
```

---

### Task 2: PII redaction layer

**Files:**
- Create: `backend/app/privacy/__init__.py` (empty), `backend/app/privacy/redaction.py`
- Test: `backend/tests/test_redaction.py`

**Interfaces:**
- Produces:
  - `Hit` — frozen dataclass `(label: str, start: int, end: int)`
  - `RedactionResult` — frozen dataclass `(text: str, hits: tuple[Hit, ...])` with property `counts -> dict[str, int]` (label → occurrences, in order of first appearance)
  - `redact_pii(text: str) -> RedactionResult` — replaces each PII span with `[LABEL]`
  - Labels (exact): `EMAIL`, `CNPJ`, `CPF`, `TELEFONE`, `CEP`, `ENDERECO`, `EMPRESA`, `NOME`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_redaction.py`:
```python
from app.privacy.redaction import redact_pii

EXAMPLE = (
    "Contratei a Reforma Fácil Ltda para reformar meu apartamento na Rua das Acácias, 142, "
    "em março de 2026. Paguei R$ 18.400 em duas parcelas. O responsável, Carlos Menezes, "
    "abandonou a obra na metade e não responde mais às mensagens. Meu CPF é 123.456.789-00 "
    "e meu telefone é (11) 98765-4321."
)


def test_redacts_all_pii_in_design_system_example():
    result = redact_pii(EXAMPLE)
    for secret in ["Reforma Fácil Ltda", "Rua das Acácias, 142", "Carlos Menezes",
                   "123.456.789-00", "98765-4321"]:
        assert secret not in result.text
    assert result.text == (
        "Contratei a [EMPRESA] para reformar meu apartamento na [ENDERECO], "
        "em março de 2026. Paguei R$ 18.400 em duas parcelas. O responsável, [NOME], "
        "abandonou a obra na metade e não responde mais às mensagens. Meu CPF é [CPF] "
        "e meu telefone é [TELEFONE]."
    )


def test_counts_follow_order_of_appearance():
    result = redact_pii(EXAMPLE)
    assert result.counts == {"EMPRESA": 1, "ENDERECO": 1, "NOME": 1, "CPF": 1, "TELEFONE": 1}


def test_redacts_email_cnpj_and_cep():
    text = "CNPJ 12.345.678/0001-90, CEP 01310-100, e-mail joao.silva@exemplo.com.br"
    assert redact_pii(text).text == "CNPJ [CNPJ], CEP [CEP], e-mail [EMAIL]"


def test_text_without_pii_is_unchanged():
    text = "paguei a primeira parcela e a obra parou na metade."
    result = redact_pii(text)
    assert result.text == text
    assert result.hits == ()


def test_hits_point_at_original_spans():
    text = "Meu CPF é 123.456.789-00."
    (hit,) = redact_pii(text).hits
    assert hit.label == "CPF"
    assert text[hit.start:hit.end] == "123.456.789-00"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/Scripts/python -m pytest tests/test_redaction.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.privacy'`.

- [ ] **Step 3: Implement**

`backend/app/privacy/redaction.py`:
```python
"""Rule-based PII redaction (MVP layer of Privacy by Design).

Ported from the design system's client-side `redact()`; extended with CNPJ and CEP.
Patterns run in priority order and a later match never overlaps an earlier one.
"""

import re
from dataclasses import dataclass

_UPPER = "A-ZÀ-ÖØ-Ý"
_LOWER = "a-zß-öø-ÿ"

_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("EMAIL", re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")),
    ("CNPJ", re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b")),
    ("CPF", re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")),
    ("TELEFONE", re.compile(r"\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b")),
    ("CEP", re.compile(r"\b\d{5}-\d{3}\b")),
    ("ENDERECO", re.compile(
        r"\b(?:Rua|Avenida|Av\.|Travessa|Alameda|Praça|Rodovia)\s[^,.\n]+(?:,\s?\d+)?"
    )),
    ("EMPRESA", re.compile(
        rf"(?:[{_UPPER}][{_UPPER}{_LOWER}]*\s)+(?:Ltda|S\.A\.|S/A|EIRELI|ME)\b\.?"
    )),
    ("NOME", re.compile(rf"[{_UPPER}][{_LOWER}]+(?:\s(?:d[aeo]s?\s)?[{_UPPER}][{_LOWER}]+)+")),
)


@dataclass(frozen=True)
class Hit:
    label: str
    start: int
    end: int


@dataclass(frozen=True)
class RedactionResult:
    text: str
    hits: tuple[Hit, ...]

    @property
    def counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for hit in self.hits:
            counts[hit.label] = counts.get(hit.label, 0) + 1
        return counts


def redact_pii(text: str) -> RedactionResult:
    hits: list[Hit] = []
    for label, pattern in _PATTERNS:
        for match in pattern.finditer(text):
            start, end = match.span()
            if not any(start < h.end and end > h.start for h in hits):
                hits.append(Hit(label, start, end))
    hits.sort(key=lambda h: h.start)

    parts: list[str] = []
    cursor = 0
    for hit in hits:
        parts.append(text[cursor:hit.start])
        parts.append(f"[{hit.label}]")
        cursor = hit.end
    parts.append(text[cursor:])
    return RedactionResult(text="".join(parts), hits=tuple(hits))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python -m pytest tests/test_redaction.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/privacy backend/tests/test_redaction.py
git commit -m "feat(privacy): rule-based PII redaction layer"
```

---

### Task 3: Database layer and models

**Files:**
- Create: `backend/app/db.py`, `backend/app/models.py`
- Test: `backend/tests/conftest.py`, `backend/tests/test_models.py`

**Interfaces:**
- Consumes: `app.config.get_database_url()`
- Produces:
  - `app.db.Base` (DeclarativeBase with constraint naming convention), `app.db.get_engine() -> Engine` (cached, lazy), `app.db.get_session() -> Iterator[Session]` (FastAPI dependency)
  - `app.models.UserRole` (`CLIENT`, `JUDGE`, `LAWYER`, `ADMIN`), `app.models.CaseStatus` (`AWAITING_JUDGE`, `READY_FOR_AGREEMENT`, `CLOSED`)
  - `app.models.User(id: UUID, email: str, role: UserRole, created_at)` — table `users`
  - `app.models.Case(id: UUID, client_id: UUID, raw_text: str, anonymized_text: str, status: CaseStatus, created_at, updated_at)` — table `cases`; relationships `client`, `reviews`
  - `app.models.CaseReview(id: UUID, case_id: UUID, judge_id: UUID, score: int 0–100, notes: str | None, created_at)` — table `case_reviews`; relationships `case`, `judge`
  - pytest fixtures `engine` and `session` (in-memory SQLite, FKs on)

- [ ] **Step 1: Write the fixtures and failing tests**

`backend/tests/conftest.py`:
```python
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (registers tables on Base.metadata)
from app.db import Base


@pytest.fixture
def engine():
    eng = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(eng, "connect")
    def _enable_foreign_keys(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def session(engine):
    with sessionmaker(bind=engine, expire_on_commit=False)() as s:
        yield s
```

`backend/tests/test_models.py`:
```python
import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Case, CaseReview, CaseStatus, User, UserRole


def _client(session, email="cliente@exemplo.com"):
    user = User(email=email, role=UserRole.CLIENT)
    session.add(user)
    session.commit()
    return user


def test_case_defaults_to_awaiting_judge_and_links_client(session):
    client = _client(session)
    case = Case(client_id=client.id, raw_text="texto original", anonymized_text="texto [NOME]")
    session.add(case)
    session.commit()
    session.refresh(case)

    assert case.status is CaseStatus.AWAITING_JUDGE
    assert case.client.email == "cliente@exemplo.com"
    assert case.created_at is not None


def test_review_links_case_and_judge(session):
    client = _client(session)
    judge = User(email="juiz@exemplo.com", role=UserRole.JUDGE)
    case = Case(client_id=client.id, raw_text="a", anonymized_text="a")
    session.add_all([judge, case])
    session.commit()

    review = CaseReview(case_id=case.id, judge_id=judge.id, score=85, notes="Prova robusta.")
    session.add(review)
    session.commit()
    session.refresh(case)

    assert [r.score for r in case.reviews] == [85]
    assert review.judge.role is UserRole.JUDGE


@pytest.mark.parametrize("score", [-1, 101])
def test_review_score_must_be_between_0_and_100(session, score):
    client = _client(session)
    judge = User(email="juiz@exemplo.com", role=UserRole.JUDGE)
    case = Case(client_id=client.id, raw_text="a", anonymized_text="a")
    session.add_all([judge, case])
    session.commit()

    session.add(CaseReview(case_id=case.id, judge_id=judge.id, score=score))
    with pytest.raises(IntegrityError):
        session.commit()


def test_user_email_is_unique(session):
    _client(session)
    session.add(User(email="cliente@exemplo.com", role=UserRole.LAWYER))
    with pytest.raises(IntegrityError):
        session.commit()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `.venv/Scripts/python -m pytest tests/test_models.py -v`
Expected: collection error — `ModuleNotFoundError: No module named 'app.models'` (or `app.db`).

- [ ] **Step 3: Implement the database layer**

`backend/app/db.py`:
```python
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_database_url

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


@lru_cache
def get_engine() -> Engine:
    return create_engine(get_database_url(), pool_pre_ping=True)


@lru_cache
def _session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_session() -> Iterator[Session]:
    with _session_factory()() as session:
        yield session
```

- [ ] **Step 4: Implement the models**

`backend/app/models.py`:
```python
import enum
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class UserRole(str, enum.Enum):
    CLIENT = "CLIENT"
    JUDGE = "JUDGE"
    LAWYER = "LAWYER"
    ADMIN = "ADMIN"


class CaseStatus(str, enum.Enum):
    AWAITING_JUDGE = "AWAITING_JUDGE"
    READY_FOR_AGREEMENT = "READY_FOR_AGREEMENT"
    CLOSED = "CLOSED"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    cases: Mapped[list["Case"]] = relationship(back_populates="client")


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    # Privacy by Design: raw_text is owner-only and must never be exposed by an API schema.
    raw_text: Mapped[str] = mapped_column(Text)
    anonymized_text: Mapped[str] = mapped_column(Text)
    status: Mapped[CaseStatus] = mapped_column(
        Enum(CaseStatus, name="case_status"), default=CaseStatus.AWAITING_JUDGE
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    client: Mapped[User] = relationship(back_populates="cases")
    reviews: Mapped[list["CaseReview"]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )


class CaseReview(Base):
    __tablename__ = "case_reviews"
    __table_args__ = (CheckConstraint("score BETWEEN 0 AND 100", name="score_range"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), index=True
    )
    judge_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    score: Mapped[int]
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    case: Mapped[Case] = relationship(back_populates="reviews")
    judge: Mapped[User] = relationship()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/Scripts/python -m pytest -v`
Expected: all tests pass (config 3 + redaction 5 + models 5 = 13).

- [ ] **Step 6: Commit**

```bash
git add backend/app/db.py backend/app/models.py backend/tests/conftest.py backend/tests/test_models.py
git commit -m "feat(db): SQLAlchemy models for User, Case and CaseReview"
```

---

### Task 4: Alembic migration applied to Neon

**Precondition (controller):** `backend/.env` exists with the Neon `DATABASE_URL`. Do not read it aloud, print it, or commit it.

**Files:**
- Create: `backend/alembic.ini`, `backend/migrations/` (via `alembic init`), `backend/migrations/versions/<rev>_create_core_tables.py` (autogenerated)
- Modify: `backend/migrations/env.py`

**Interfaces:**
- Consumes: `app.db.Base`, `app.config.get_database_url()`, `app.models`
- Produces: Neon database `peacelaw` containing tables `users`, `cases`, `case_reviews`, `alembic_version`, and enum types `user_role`, `case_status`.

- [ ] **Step 1: Scaffold Alembic**

Run (from `backend/`): `.venv/Scripts/python -m alembic init migrations`
Expected: creates `alembic.ini` and `migrations/`.

- [ ] **Step 2: Remove the placeholder URL from `alembic.ini`**

Delete the line `sqlalchemy.url = driver://user:pass@localhost/dbname` (the URL is injected from the environment in `env.py`).

- [ ] **Step 3: Wire `migrations/env.py` to the app metadata**

In `backend/migrations/env.py`, replace the block
```python
# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
target_metadata = None
```
with
```python
import app.models  # noqa: E402,F401  (registers tables)
from app.config import get_database_url  # noqa: E402
from app.db import Base  # noqa: E402

# ConfigParser treats '%' as interpolation; escape it (passwords may be URL-encoded).
config.set_main_option("sqlalchemy.url", get_database_url().replace("%", "%%"))
target_metadata = Base.metadata
```
Also, in both `context.configure(...)` calls (offline and online), add `compare_type=True,`.

`alembic.ini` already sets `prepend_sys_path = .`, so `app` is importable when running from `backend/`.

- [ ] **Step 4: Autogenerate the initial revision**

Run: `.venv/Scripts/python -m alembic revision --autogenerate -m "create core tables"`
Expected: a new file in `migrations/versions/` whose `upgrade()` creates `users`, `cases`, `case_reviews` (with `ck_case_reviews_score_range`, FKs, indexes `ix_users_email` unique, `ix_cases_client_id`, `ix_case_reviews_case_id`, `ix_case_reviews_judge_id`).

- [ ] **Step 5: Make `downgrade()` drop the Postgres enum types**

Autogenerate does not drop enum types. At the end of `downgrade()` in the new revision file, append:
```python
    sa.Enum(name="case_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="user_role").drop(op.get_bind(), checkfirst=True)
```

- [ ] **Step 6: Apply, round-trip, and verify**

Run:
```bash
.venv/Scripts/python -m alembic upgrade head
.venv/Scripts/python -m alembic downgrade base
.venv/Scripts/python -m alembic upgrade head
.venv/Scripts/python -m alembic check
.venv/Scripts/python -c "from sqlalchemy import inspect; from app.db import get_engine; print(sorted(inspect(get_engine()).get_table_names()))"
```
Expected: no errors; `alembic check` prints `No new upgrade operations detected.`; last line prints `['alembic_version', 'case_reviews', 'cases', 'users']`.

- [ ] **Step 7: Run the unit tests (unchanged behaviour)**

Run: `.venv/Scripts/python -m pytest -v`
Expected: 13 passed.

- [ ] **Step 8: Commit**

```bash
git add backend/alembic.ini backend/migrations
git commit -m "feat(db): Alembic initial migration for core tables"
```
(Confirm `git status` does not list `backend/.env` before committing.)

---

### Task 5: `/api/cases` endpoints with PII redaction

**Files:**
- Create: `backend/app/schemas.py`, `backend/app/routers/__init__.py` (empty), `backend/app/routers/cases.py`, `backend/main.py`
- Test: `backend/tests/test_cases_api.py`

**Interfaces:**
- Consumes: `redact_pii`, `RedactionResult.counts`, `get_session`, `Case`, `User`, `UserRole`, `CaseStatus`, fixtures `session`
- Produces (HTTP):
  - `POST /api/cases` body `{"client_id": UUID, "text": str(40..20000)}` → `201 {"id", "anonymized_text", "status", "created_at", "redactions": [{"label", "count"}]}`; `404 {"detail": "Cliente não encontrado."}` when the id is unknown or not a CLIENT; `422` on validation errors.
  - `GET /api/cases` → `200 [CasePublic]`
  - `GET /api/cases/{case_id}` → `200 CasePublic` | `404 {"detail": "Caso não encontrado."}`
  - `GET /health` → `200 {"status": "ok"}`
  - `main.app` (FastAPI instance; CORS allows `http://localhost:3000`)
- Python: `app.schemas.CaseCreate`, `app.schemas.CasePublic`, `app.schemas.CaseCreated`, `app.schemas.RedactionCount`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_cases_api.py`:
```python
import uuid

import pytest
from fastapi.testclient import TestClient

from app.db import get_session
from app.models import Case, User, UserRole
from main import app

TEXT = (
    "O responsável, Carlos Menezes, abandonou a obra. Meu CPF é 123.456.789-00 "
    "e meu telefone é (11) 98765-4321."
)


@pytest.fixture
def api(session):
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


@pytest.fixture
def client_user(session):
    user = User(email="cliente@exemplo.com", role=UserRole.CLIENT)
    session.add(user)
    session.commit()
    return user


def test_health(api):
    assert api.get("/health").json() == {"status": "ok"}


def test_create_case_redacts_and_never_returns_raw_text(api, session, client_user):
    res = api.post("/api/cases", json={"client_id": str(client_user.id), "text": TEXT})

    assert res.status_code == 201
    body = res.json()
    assert "raw_text" not in body
    assert "123.456.789-00" not in res.text and "Carlos Menezes" not in res.text
    assert body["anonymized_text"] == (
        "O responsável, [NOME], abandonou a obra. Meu CPF é [CPF] e meu telefone é [TELEFONE]."
    )
    assert body["status"] == "AWAITING_JUDGE"
    assert body["redactions"] == [
        {"label": "NOME", "count": 1},
        {"label": "CPF", "count": 1},
        {"label": "TELEFONE", "count": 1},
    ]

    stored = session.get(Case, uuid.UUID(body["id"]))
    assert stored.raw_text == TEXT


def test_create_case_rejects_unknown_client(api):
    res = api.post("/api/cases", json={"client_id": str(uuid.uuid4()), "text": TEXT})
    assert res.status_code == 404
    assert res.json() == {"detail": "Cliente não encontrado."}


def test_create_case_rejects_non_client_role(api, session):
    judge = User(email="juiz@exemplo.com", role=UserRole.JUDGE)
    session.add(judge)
    session.commit()
    res = api.post("/api/cases", json={"client_id": str(judge.id), "text": TEXT})
    assert res.status_code == 404


def test_create_case_requires_minimum_length(api, client_user):
    res = api.post("/api/cases", json={"client_id": str(client_user.id), "text": "curto"})
    assert res.status_code == 422


def test_list_and_get_expose_only_anonymized_text(api, client_user):
    created = api.post(
        "/api/cases", json={"client_id": str(client_user.id), "text": TEXT}
    ).json()

    listed = api.get("/api/cases")
    assert listed.status_code == 200
    assert [c["id"] for c in listed.json()] == [created["id"]]
    assert "raw_text" not in listed.json()[0]
    assert "123.456.789-00" not in listed.text

    one = api.get(f"/api/cases/{created['id']}")
    assert one.status_code == 200
    assert one.json()["anonymized_text"] == created["anonymized_text"]
    assert "raw_text" not in one.json()


def test_get_unknown_case_returns_404(api):
    res = api.get(f"/api/cases/{uuid.uuid4()}")
    assert res.status_code == 404
    assert res.json() == {"detail": "Caso não encontrado."}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `.venv/Scripts/python -m pytest tests/test_cases_api.py -v`
Expected: collection error — `ModuleNotFoundError: No module named 'main'`.

- [ ] **Step 3: Implement schemas**

`backend/app/schemas.py`:
```python
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import CaseStatus


class CaseCreate(BaseModel):
    client_id: uuid.UUID
    text: str = Field(min_length=40, max_length=20_000)


class RedactionCount(BaseModel):
    label: str
    count: int


class CasePublic(BaseModel):
    """Third-party view of a case. Never add raw_text here (Privacy by Design)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    anonymized_text: str
    status: CaseStatus
    created_at: datetime


class CaseCreated(CasePublic):
    redactions: list[RedactionCount]
```

- [ ] **Step 4: Implement the router**

`backend/app/routers/cases.py`:
```python
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Case, User, UserRole
from app.privacy.redaction import redact_pii
from app.schemas import CaseCreate, CaseCreated, CasePublic, RedactionCount

router = APIRouter(prefix="/api/cases", tags=["cases"])

SessionDep = Annotated[Session, Depends(get_session)]


@router.post("", status_code=status.HTTP_201_CREATED, response_model=CaseCreated)
def create_case(payload: CaseCreate, db: SessionDep) -> CaseCreated:
    client = db.get(User, payload.client_id)
    if client is None or client.role is not UserRole.CLIENT:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cliente não encontrado.")

    result = redact_pii(payload.text)
    case = Case(client_id=client.id, raw_text=payload.text, anonymized_text=result.text)
    db.add(case)
    db.commit()
    db.refresh(case)

    return CaseCreated(
        **CasePublic.model_validate(case).model_dump(),
        redactions=[RedactionCount(label=k, count=v) for k, v in result.counts.items()],
    )


@router.get("", response_model=list[CasePublic])
def list_cases(db: SessionDep) -> list[Case]:
    return list(db.scalars(select(Case).order_by(Case.created_at.desc())))


@router.get("/{case_id}", response_model=CasePublic)
def get_case(case_id: uuid.UUID, db: SessionDep) -> Case:
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Caso não encontrado.")
    return case
```

- [ ] **Step 5: Implement the app entrypoint**

`backend/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import cases

app = FastAPI(title="PeaceLaw API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

app.include_router(cases.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 6: Run all tests**

Run: `.venv/Scripts/python -m pytest -v`
Expected: 20 passed (13 previous + 7 API).

- [ ] **Step 7: Smoke-test against Neon**

Run (from `backend/`):
```bash
.venv/Scripts/python -c "from fastapi.testclient import TestClient; from main import app; c = TestClient(app); print(c.get('/health').json(), c.get('/api/cases').status_code)"
```
Expected: `{'status': 'ok'} 200` (real Neon session, empty list).

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas.py backend/app/routers backend/main.py backend/tests/test_cases_api.py
git commit -m "feat(api): /api/cases with PII redaction, public views only"
```

---

## STOP — Milestone 1 gate

Show the user `backend/app/models.py`, the applied tables in Neon, and the test results; ask for approval (including the open question on column-level encryption for `raw_text`) before planning Milestone 2.
