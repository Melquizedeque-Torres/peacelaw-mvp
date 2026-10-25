"""Password policy beyond length: refuse the passwords attackers try first.

Offline and dependency-free on purpose (no third-party breach API). Length (12 to 128) is
enforced by the schema; this adds a small blocklist and a few shape checks.
"""

import re

from pydantic_core import PydanticCustomError

WEAK_MESSAGE = "Escolha uma senha menos comum e menos previsível."

_COMMON = frozenset(
    {
        "password1234", "password12345", "password123456", "passwordpassword", "senha1234567",
        "senha12345678", "senhasenhasenha", "minhasenha123", "minhasenha1234", "123456789012",
        "1234567890123", "12345678901234", "qwertyuiop12", "qwertyuiopas", "qwertyuiop123",
        "asdfghjkl123", "asdfghjklzxc", "zxcvbnm12345", "peacelaw1234", "peacelaw12345",
        "peacelaw123456", "administrador", "administrator", "administrador1", "mudar123456",
        "trocar123456", "brasil123456", "brasileiro123", "iloveyou1234", "letmein12345",
        "welcome12345", "abc123456789", "abcdefghijkl", "changeme1234", "default12345",
        "corinthians1", "flamengo1234", "palmeiras123", "123123123123", "111111111111",
        "000000000000", "admin1234567", "admin12345678", "teste1234567", "usuario12345",
    }
)

_RUNS = ("0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiopasdfghjklzxcvbnm")


def _is_sequence(value: str) -> bool:
    for run in _RUNS:
        doubled, back = run * 2, run[::-1] * 2  # wrap around: 8901234..., 9876543210987
        if value in doubled or value in back:
            return True
    return False


def is_weak(password: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", password.lower())
    return (
        normalized in _COMMON
        or len(set(password)) < 5
        or (len(normalized) >= 8 and _is_sequence(normalized))
        or any(normalized.startswith(common) and len(normalized) <= len(common) + 2 for common in _COMMON)
    )


def validate_strong(password: str) -> str:
    if is_weak(password):
        raise PydanticCustomError("weak_password", WEAK_MESSAGE)
    return password
