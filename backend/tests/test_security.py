import os
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.fernet import Fernet

from app.security import crypto, passwords
from app.security.passwords import hash_password, verify_password
from app.security.tokens import create_access_token, decode_session


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
    assert verify_password("qualquer-coisa-1", "$argon2id$garbage") is False


def test_unusable_hash_still_runs_dummy_verification(monkeypatch):
    calls = []
    real_verify = passwords._hasher.verify

    def spy(password, password_hash):
        calls.append(password_hash)
        return real_verify(password, password_hash)

    monkeypatch.setattr(passwords._hasher, "verify", spy)
    assert verify_password("qualquer-coisa-1", "!") is False
    assert verify_password("qualquer-coisa-1", "$argon2id$garbage") is False
    assert calls.count(passwords._DUMMY_HASH) == 2  # one dummy Argon2 run per unusable hash


def test_token_roundtrip():
    user_id = uuid.uuid4()
    assert decode_session(create_access_token(user_id)) == (user_id, 0)


def test_tampered_expired_and_foreign_tokens_are_rejected():
    secret = os.environ["JWT_SECRET"]
    user_id = uuid.uuid4()
    assert decode_session(create_access_token(user_id) + "x") is None
    expired = jwt.encode(
        {"sub": str(user_id), "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
        secret,
        algorithm="HS256",
    )
    assert decode_session(expired) is None
    foreign = jwt.encode(
        {"sub": str(user_id), "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
        "outro-segredo-" + "y" * 40,
        algorithm="HS256",
    )
    assert decode_session(foreign) is None
    missing_exp = jwt.encode({"sub": str(user_id)}, secret, algorithm="HS256")
    assert decode_session(missing_exp) is None
    assert decode_session("lixo") is None


# The shared test secret is shorter than the SHA-512 recommendation; the warning is expected.
@pytest.mark.filterwarnings("ignore:The HMAC key is:UserWarning")
def test_alg_none_and_foreign_algorithm_tokens_are_rejected():
    secret = os.environ["JWT_SECRET"]
    user_id = uuid.uuid4()
    exp = datetime.now(timezone.utc) + timedelta(minutes=5)
    alg_none = jwt.encode({"sub": str(user_id), "exp": exp}, None, algorithm="none")
    assert decode_session(alg_none) is None
    hs512 = jwt.encode({"sub": str(user_id), "exp": exp}, secret, algorithm="HS512")
    assert decode_session(hs512) is None
