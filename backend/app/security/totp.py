"""RFC 6238 time-based one-time passwords (SHA-1, 30 s, 6 digits) and recovery codes.

Standard library only. The secret is stored encrypted (EncryptedText); recovery codes are
stored as keyed hashes and each works once.
"""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

from app.config import get_jwt_secret

STEP_SECONDS = 30
DIGITS = 6
WINDOW = 1  # accept the previous, current and next step (clock drift)
RECOVERY_CODES = 8
ISSUER = "PeaceLaw"


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _hotp(secret: str, counter: int) -> str:
    padded = secret + "=" * (-len(secret) % 8)
    digest = hmac.new(base64.b32decode(padded), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**DIGITS).zfill(DIGITS)


def current_step(now: float | None = None) -> int:
    return int((time.time() if now is None else now) // STEP_SECONDS)


def code_at(secret: str, step: int) -> str:
    return _hotp(secret, step)


def match_step(secret: str, code: str, now: float | None = None) -> int | None:
    """The time step the code belongs to (within the drift window), or None."""
    candidate = code.strip().replace(" ", "")
    if len(candidate) != DIGITS or not candidate.isdigit():
        return None
    step = current_step(now)
    found = None
    for s in range(step - WINDOW, step + WINDOW + 1):
        # Compare every step: constant work whether or not an earlier one matched.
        if hmac.compare_digest(_hotp(secret, s), candidate) and found is None:
            found = s
    return found


def provisioning_uri(email: str, secret: str) -> str:
    return (
        f"otpauth://totp/{quote(ISSUER)}:{quote(email)}?secret={secret}"
        f"&issuer={quote(ISSUER)}&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}"
    )


def new_recovery_codes() -> list[str]:
    codes = []
    for _ in range(RECOVERY_CODES):
        raw = base64.b32encode(secrets.token_bytes(7)).decode("ascii").lower()[:10]
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def normalize_recovery(code: str) -> str:
    return code.strip().lower().replace(" ", "")


def hash_recovery(code: str) -> str:
    return hmac.new(get_jwt_secret().encode(), normalize_recovery(code).encode(), hashlib.sha256).hexdigest()


def looks_like_recovery(code: str) -> bool:
    c = normalize_recovery(code)
    return len(c) == 11 and c[5] == "-"
