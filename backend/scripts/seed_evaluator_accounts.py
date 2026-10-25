"""Seed PUBLIC test accounts (client, judge, lawyer, admin) and sample cases for evaluators.

The passwords are published in the README on purpose, so this script may only run against a
throw-away database: it refuses when any other account exists, so it cannot be pointed at real data.

Usage, from backend/:  python -m scripts.seed_evaluator_accounts --public-demo
Existing demo accounts keep their data; the passwords are reset to the published ones.
"""

import argparse
import sys
from datetime import datetime, timezone

from sqlalchemy import select, update

from app.consent import CONSENT_VERSION
from app.db import _session_factory
from app.models import Case, CaseArea, CaseReview, CaseStatus, User, UserRole
from app.privacy.redaction import redact_pii
from app.scoring import probability_score
from app.security.passwords import hash_password

ACCOUNTS = (
    ("cliente.avaliador@peacelaw.dev", UserRole.CLIENT, "cliente-avaliador-2026"),
    ("juiz.avaliador@peacelaw.dev", UserRole.JUDGE, "juiz-avaliador-2026"),
    ("advogado.avaliador@peacelaw.dev", UserRole.LAWYER, "advogado-avaliador-2026"),
    ("admin.avaliador@peacelaw.dev", UserRole.ADMIN, "admin-avaliador-azul-2026"),
)

SAMPLE_CASES = (
    (
        "Obra abandonada pelo empreiteiro",
        CaseArea.CIVIL,
        "O empreiteiro Carlos Menezes abandonou a reforma da minha casa depois de receber R$ 18.400. "
        "Meu CPF é 123.456.789-00 e meu telefone é (41) 98765-4321. Já se passaram quatro meses sem "
        "retorno e as paredes seguem sem acabamento, com infiltração no banheiro.",
        None,
    ),
    (
        "Cobrança indevida de multa no plano de internet",
        CaseArea.CONSUMIDOR,
        "Cancelei meu plano de internet em março e a empresa continuou cobrando mensalidades e ainda "
        "aplicou uma multa de fidelidade que não consta no contrato. Falei com a atendente Paula Souza "
        "três vezes e o problema não foi resolvido.",
        (8, 7),
    ),
    (
        "Horas extras não pagas",
        CaseArea.TRABALHISTA,
        "Trabalhei dois anos como vendedor fazendo plantões aos sábados sem receber as horas extras "
        "previstas. Moro em Curitiba e pretendo resolver o caso por acordo, sem processo.",
        (5, 6),
    ),
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--public-demo", action="store_true", help="confirm this database is a public demo")
    args = parser.parse_args(argv)
    if not args.public_demo:
        print("Recusado: passe --public-demo para confirmar que este banco é uma demonstração pública.", file=sys.stderr)
        return 2

    emails = {email for email, _, _ in ACCOUNTS}
    with _session_factory()() as db:
        strangers = [e for e in db.scalars(select(User.email)) if e not in emails]
        if strangers:
            print(
                f"Recusado: o banco tem {len(strangers)} conta(s) que não são de demonstração. "
                "Use apenas em um banco descartável.",
                file=sys.stderr,
            )
            return 1
        users: dict[UserRole, User] = {}
        for email, role, password in ACCOUNTS:
            user = db.scalar(select(User).where(User.email == email))
            digest = hash_password(password)
            if user is None:
                user = User(email=email, role=role, password_hash=digest)
                db.add(user)
            else:
                db.execute(
                    update(User)
                    .where(User.id == user.id)
                    .values(password_hash=digest, is_active=True, token_version=User.token_version + 1)
                )
            users[role] = user
        db.flush()

        client, judge = users[UserRole.CLIENT], users[UserRole.JUDGE]
        existing = set(db.scalars(select(Case.title).where(Case.client_id == client.id)))
        for title, area, text, scores in SAMPLE_CASES:
            if title in existing:
                continue
            redacted_title, redacted_text = redact_pii(title), redact_pii(text)
            case = Case(
                client_id=client.id,
                title=redacted_title.text,
                raw_text=text,
                anonymized_text=redacted_text.text,
                status=CaseStatus.READY_FOR_JUDGE,
                area=area,
                consent_at=datetime.now(timezone.utc),
                consent_version=CONSENT_VERSION,
            )
            db.add(case)
            db.flush()
            if scores:
                review = CaseReview(
                    case_id=case.id, judge_id=judge.id, score_evidence=scores[0], score_jurisprudence=scores[1]
                )
                db.add(review)
                db.flush()
                case.ai_probability_score = probability_score([review])
                case.status = CaseStatus.EVALUATED
        db.commit()
    print("Contas de avaliação prontas:")
    for email, role, password in ACCOUNTS:
        print(f"  {role.value:<7} {email}  senha: {password}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
