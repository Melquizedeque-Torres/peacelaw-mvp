import threading

from pwdlib import PasswordHash
from pwdlib.exceptions import PwdlibError

_hasher = PasswordHash.recommended()  # Argon2id
# Argon2 is memory-hard: bound concurrent hashing so a burst of logins cannot exhaust RAM.
_argon_slots = threading.BoundedSemaphore(4)
# Verifying against a dummy hash when the e-mail is unknown keeps login timing
# similar for existing and non-existing accounts.
_DUMMY_HASH = _hasher.hash("peacelaw-timing-equalizer")


def _verify(password: str, password_hash: str) -> bool:
    with _argon_slots:
        return _hasher.verify(password, password_hash)


def hash_password(password: str) -> str:
    with _argon_slots:
        return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if password_hash is None:
        _verify(password, _DUMMY_HASH)
        return False
    try:
        return _verify(password, password_hash)
    except PwdlibError:
        # Unusable or malformed stored hash: still pay the dummy cost so the response
        # time does not reveal that the account has no usable password.
        _verify(password, _DUMMY_HASH)
        return False
