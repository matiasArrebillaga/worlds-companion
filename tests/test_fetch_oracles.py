import json

from pipeline.fetch_oracles import is_fresh


def test_extract_is_fresh_only_for_a_while(tmp_path):
    path = tmp_path / "oracles_2026.json"
    assert not is_fresh(path, "2026-10-15T10:00:00Z")
    path.write_text(json.dumps({"fetched_at": "2026-10-15T00:00:00Z", "columns": [], "rows": []}), encoding="utf-8")
    assert is_fresh(path, "2026-10-15T10:00:00Z")
    assert not is_fresh(path, "2026-10-16T10:00:00Z")
