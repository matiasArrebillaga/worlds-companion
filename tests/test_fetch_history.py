from pipeline.fetch_history import pages_to_fetch
from pipeline.leaguepedia import in_clause


def test_current_year_skips_worlds_pages():
    tournaments = [{"OverviewPage": "LCK/2026 Season/Cup"},
                   {"OverviewPage": "2026 Season World Championship/Play-In"}]
    assert pages_to_fetch(tournaments, 2026) == ["LCK/2026 Season/Cup"]
    assert len(pages_to_fetch(tournaments, 2025)) == 2


def test_in_clause_escapes_quotes():
    assert in_clause("League", ["LCK", 'A "B"']) == 'League IN ("LCK","A \\"B\\"")'
