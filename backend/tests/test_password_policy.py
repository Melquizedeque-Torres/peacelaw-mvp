import pytest

from app.security.password_policy import is_weak
from tests.conftest import PASSWORD

WEAK = [
    "123456789012", "Password1234", "senha1234567", "qwertyuiop12", "aaaaaaaaaaaa",
    "abcdefghijkl", "PeaceLaw1234", "minha-senha-123", "111111111111", "Administrador",
    "senhasenhasenha1", "9876543210987",
]
STRONG = [PASSWORD, "cavalo-bateria-grampo-lua", "X7#mQ2!vL9@pR4", "outra-senha-qualquer-1"]


@pytest.mark.parametrize("password", WEAK)
def test_common_and_predictable_passwords_are_weak(password):
    assert is_weak(password), password


@pytest.mark.parametrize("password", STRONG)
def test_reasonable_passwords_pass(password):
    assert not is_weak(password), password


def test_signup_refuses_a_weak_password_with_a_clear_field_error(client_factory):
    res = client_factory().post("/api/auth/register", json={"email": "a@exemplo.com", "password": "Password1234"})
    assert res.status_code == 422
    assert res.json()["errors"] == [{"field": "password", "message": "Escolha uma senha menos comum e menos previsível."}]


def test_change_password_refuses_a_weak_new_password(login):
    client, _ = login()
    res = client.post("/api/auth/change-password", json={"current_password": PASSWORD, "new_password": "123456789012"})
    assert res.status_code == 422
    assert client.get("/api/auth/me").status_code == 200
