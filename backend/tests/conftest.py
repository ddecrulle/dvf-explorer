"""Tests never query live publications or inherit local administration settings."""

import pytest


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    monkeypatch.setenv("DVF_DATASET_URL", "local")
    monkeypatch.delenv("DVF_ADMIN_TOKEN", raising=False)
