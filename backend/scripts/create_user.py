"""Create a JUDGE, LAWYER or ADMIN account (the audited path for production accounts).

Usage, from backend/:
  .venv/Scripts/python -m scripts.create_user --email juiza@tribunal.jus.br --role JUDGE
  (prompts for the password twice; it is never echoed, printed or accepted as an argument)
  ... --password-stdin   reads the password from the first line of stdin (automation/vault)
Public sign-up only creates CLIENT accounts. Existing e-mails are never modified.
Exit codes: 0 created, 1 refused (invalid input or e-mail in use), 2 usage error.
"""

import argparse
import getpass
import logging
import sys

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import _session_factory
from app.models import User, UserRole
from app.schemas import RegisterIn
from app.security.passwords import hash_password

logger = logging.getLogger("app.accounts")
SERVER_SIDE_ROLES = (UserRole.JUDGE.value, UserRole.LAWYER.value, UserRole.ADMIN.value)
FIELD_ERRORS = {
    "email": "e-mail inválido.",
    "password": "a senha precisa ter de 12 a 128 caracteres.",
}


def _fail(message: str) -> int:
    print(f"Erro: {message}", file=sys.stderr)
    return 1


def _read_password(from_stdin: bool) -> str | None:
    if from_stdin:
        return sys.stdin.readline().rstrip("\r\n")
    password = getpass.getpass("Senha: ")
    if getpass.getpass("Repita a senha: ") != password:
        return None
    return password


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--email", required=True)
    parser.add_argument("--role", required=True, choices=SERVER_SIDE_ROLES)
    parser.add_argument("--password-stdin", action="store_true",
                        help="read the password from the first line of stdin")
    args = parser.parse_args(argv)

    password = _read_password(args.password_stdin)
    if password is None:
        return _fail("as senhas não conferem.")
    try:
        data = RegisterIn(email=args.email, password=password)
    except ValidationError as exc:
        # Never echo the input: pydantic errors carry the rejected value.
        fields = sorted({str(err["loc"][0]) for err in exc.errors()})
        return _fail(" ".join(FIELD_ERRORS.get(f, f"{f} inválido.") for f in fields))

    role = UserRole(args.role)
    with _session_factory()() as db:
        if db.scalar(select(User.id).where(User.email == data.email)) is not None:
            return _fail(f"{data.email} já existe; nenhuma conta foi alterada.")
        user = User(email=data.email, role=role, password_hash=hash_password(data.password))
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            return _fail(f"{data.email} já existe; nenhuma conta foi alterada.")
        logger.info("account created: role=%s id=%s", role.value, user.id)
        print(f"Conta criada: {role.value} {data.email} (id {user.id}).")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    sys.exit(main())
