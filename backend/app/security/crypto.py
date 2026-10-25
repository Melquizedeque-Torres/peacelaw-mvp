"""Column-level encryption at rest for raw_text (Segurança/LGPD source: mandatory).

MultiFernet: the first key in RAW_TEXT_KEYS encrypts, every key can decrypt, so a key
is rotated by prepending a new one and re-saving rows at leisure.
"""

from functools import lru_cache

from cryptography.fernet import Fernet, MultiFernet
from sqlalchemy import Dialect, LargeBinary, Text
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


def encrypt_bytes(data: bytes) -> bytes:
    return _fernet().encrypt(data)


def decrypt_bytes(token: bytes) -> bytes:
    return _fernet().decrypt(token)


class EncryptedBytes(TypeDecorator[bytes]):
    """LargeBinary column stored as a Fernet token."""

    impl = LargeBinary
    cache_ok = True

    def process_bind_param(self, value: bytes | None, dialect: Dialect) -> bytes | None:
        return None if value is None else encrypt_bytes(value)

    def process_result_value(self, value: bytes | None, dialect: Dialect) -> bytes | None:
        return None if value is None else decrypt_bytes(bytes(value))
