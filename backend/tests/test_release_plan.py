"""Release policy tests: no credentials, GitHub calls or registry writes."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from release_plan import plan

MAIN = "refs/heads/main"
COMMIT = "a" * 40
PREVIOUS = "b" * 40


def test_first_release_and_version_bump_publish_versioned_image():
    for tags in ({}, {"v0.9.0": PREVIOUS}):
        result = plan("1.0.0", COMMIT, MAIN, tags)
        assert result["release"] == "true"
        assert result["tag"] == "v1.0.0"
        assert result["image_tags"].splitlines() == [
            f"ddecrulle/dvf-explorer:sha-{COMMIT}",
            "ddecrulle/dvf-explorer:main",
            "ddecrulle/dvf-explorer:v1.0.0",
        ]


def test_unchanged_version_never_overwrites_version_tag():
    result = plan("1.0.0", COMMIT, MAIN, {"v1.0.0": PREVIOUS})
    assert result["release"] == "false"
    assert "dvf-explorer:v1.0.0" not in result["image_tags"]


def test_retry_can_repair_release_after_a_partial_failure():
    result = plan("1.0.0", COMMIT, MAIN, {"v1.0.0": COMMIT})
    assert result["release"] == "true"


def test_manual_tag_must_match_version_and_commit():
    result = plan("1.0.0", COMMIT, "refs/tags/v1.0.0", {"v1.0.0": COMMIT})
    assert result["release"] == "true"
    assert "dvf-explorer:main" not in result["image_tags"]
    with pytest.raises(ValueError, match="match VERSION"):
        plan("1.0.0", COMMIT, "refs/tags/v1.1.0", {})
    with pytest.raises(ValueError, match="this commit"):
        plan("1.0.0", COMMIT, "refs/tags/v1.0.0", {"v1.0.0": PREVIOUS})


@pytest.mark.parametrize(
    "version", ["1.0", "v1.0.0", "01.0.0", "1.0.0-beta.1", "1.0.0\nother=true"]
)
def test_invalid_versions_are_rejected(version):
    with pytest.raises(ValueError, match="MAJOR.MINOR.PATCH"):
        plan(version, COMMIT, MAIN, {})


def test_releases_cannot_go_backwards_and_unrelated_tags_are_ignored():
    with pytest.raises(ValueError, match="lower"):
        plan("1.0.0", COMMIT, MAIN, {"v1.1.0": PREVIOUS})
    assert plan("1.0.0", COMMIT, MAIN, {"v-old": PREVIOUS})["release"] == "true"
