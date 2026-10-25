"""Create demo CLIENT, JUDGE and LAWYER accounts (development only).

Usage, from backend/:  .venv/Scripts/python -m scripts.seed_demo_users
Each new account's generated password is printed once; existing accounts are untouched.
JUDGE and LAWYER accounts can only be created server-side (public sign-up is CLIENT-only).
"""

import os
import secrets
import sys

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
    if os.environ.get("APP_ENV", "development").strip().lower() == "production":
        sys.exit("Recusado: contas demo não podem ser criadas com APP_ENV=production. "
                 "Use scripts.create_user.")
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
