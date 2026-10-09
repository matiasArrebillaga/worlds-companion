import pytest

from pipeline import leaguepedia


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


class FakeSession:
    """Sesión falsa: devuelve las respuestas en orden y guarda los parámetros."""

    def __init__(self, payloads):
        self.payloads = list(payloads)
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append(params)
        return FakeResponse(self.payloads.pop(0))


RATE_LIMITED = {"error": {"code": "ratelimited", "info": "You've exceeded your rate limit."}}


def page(*rows):
    return {"cargoquery": [{"title": row} for row in rows]}


def test_returns_rows_from_title():
    session = FakeSession([page({"Team1": "T1"}, {"Team1": "G2"})])
    rows = leaguepedia.cargo_query(session, tables="MatchSchedule", fields="Team1")
    assert rows == [{"Team1": "T1"}, {"Team1": "G2"}]
    assert session.calls[0]["action"] == "cargoquery"


def test_retries_rate_limit_with_backoff():
    sleeps = []
    session = FakeSession([RATE_LIMITED, RATE_LIMITED, page({"Team1": "T1"})])
    rows = leaguepedia.cargo_query(session, tables="T", fields="F", sleep=sleeps.append)
    assert rows == [{"Team1": "T1"}]
    assert sleeps == [10, 20]


def test_gives_up_after_five_rate_limits():
    sleeps = []
    session = FakeSession([RATE_LIMITED] * 5)
    with pytest.raises(leaguepedia.RateLimited):
        leaguepedia.cargo_query(session, tables="T", fields="F", sleep=sleeps.append)
    assert sleeps == [10, 20, 40, 80]


def test_other_api_errors_fail_immediately():
    session = FakeSession([{"error": {"code": "badquery", "info": "bad"}}])
    with pytest.raises(leaguepedia.LeaguepediaError, match="badquery"):
        leaguepedia.cargo_query(session, tables="T", fields="F", sleep=lambda s: None)


def test_paginates_until_short_page(monkeypatch):
    monkeypatch.setattr(leaguepedia, "PAGE_SIZE", 2)
    session = FakeSession([page({"n": "1"}, {"n": "2"}), page({"n": "3"})])
    rows = leaguepedia.cargo_query(session, tables="T", fields="F")
    assert [r["n"] for r in rows] == ["1", "2", "3"]
    assert [c["offset"] for c in session.calls] == [0, 2]


def test_login_failure_raises(monkeypatch):
    class LoginSession(FakeSession):
        def post(self, url, data=None, timeout=None):
            return FakeResponse({"login": {"result": "Failed", "reason": "wrong password"}})

    session = LoginSession([{"query": {"tokens": {"logintoken": "abc+\\"}}}])
    with pytest.raises(leaguepedia.LeaguepediaError, match="login failed"):
        leaguepedia.login(session, "User@bot", "secret")
