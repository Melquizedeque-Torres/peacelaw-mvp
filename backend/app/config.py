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
    # Secure by default; only the literal "false" opts out (plain-http dev).
    return os.environ.get("COOKIE_SECURE", "").strip().lower() != "false"


def rate_limit(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default


def max_body_bytes() -> int:
    return rate_limit("MAX_BODY_BYTES", 131072)


def evidence_max_bytes() -> int:
    from app.evidence import MAX_BYTES

    return MAX_BYTES + 4096  # headroom so the endpoint, not the middleware, answers 413


def rate_limit_store() -> str:
    explicit = os.environ.get("RATE_LIMIT_STORE", "").strip().lower()
    if explicit in ("memory", "db"):
        return explicit
    return "db" if os.environ.get("APP_ENV", "").strip().lower() == "production" else "memory"
