import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import sync_remote


@pytest.mark.parametrize(
    "timestamp, expected",
    [
        ("2026-04-01T07:00:00+00:00", True),
        ("2026-04-14T14:00:00+00:00", True),
        ("2026-04-15T07:00:00+00:00", True),
        ("2026-04-04T07:00:00+00:00", False),
        ("2026-04-05T14:00:00+00:00", False),
        ("2026-10-01T07:00:00+00:00", True),
        ("2026-10-14T14:00:00+00:00", True),
        ("2026-10-15T07:00:00+00:00", True),
        ("2026-10-03T14:00:00+00:00", False),
        ("2026-05-01T07:00:00+00:00", True),
        # Local date, rather than the host's UTC date, determines eligibility.
        ("2026-03-31T22:30:00+00:00", True),
        ("2026-04-14T22:30:00+00:00", True),
    ],
)
def test_publication_window(timestamp, expected):
    assert (
        sync_remote.in_publication_window(datetime.fromisoformat(timestamp)) is expected
    )


def test_scheduled_skip_does_not_read_credentials_or_call_api(monkeypatch):
    class WeekendClock:
        @staticmethod
        def now(tz):
            return datetime(2026, 4, 4, 7, tzinfo=timezone.utc).astimezone(tz)

    monkeypatch.setattr(sync_remote, "datetime", WeekendClock)
    monkeypatch.delenv("DVF_API_URL", raising=False)
    monkeypatch.delenv("DVF_ADMIN_TOKEN", raising=False)
    monkeypatch.setattr(
        sync_remote.httpx, "Client", lambda **kwargs: pytest.fail("Unexpected API call")
    )
    sync_remote.main(scheduled=True)


def test_manual_run_bypasses_publication_window(monkeypatch):
    monkeypatch.setattr(
        sync_remote,
        "in_publication_window",
        lambda now: pytest.fail("Manual runs must not check the window"),
    )
    monkeypatch.delenv("DVF_API_URL", raising=False)
    # Reaching configuration proves that the manual run was not silently skipped.
    with pytest.raises(KeyError, match="DVF_API_URL"):
        sync_remote.main()
