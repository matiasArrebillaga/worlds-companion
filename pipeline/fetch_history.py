"""Descarga, una sola vez, el historial que necesita el Elo (ligas + internacionales de cada año).

Uso: python -m pipeline.fetch_history           # baja solo los años que falten en data/raw/
     python -m pipeline.fetch_history --force   # vuelve a bajar todo
2019–2025 se usan para los backtests. Del año actual no se baja Worlds: lo hace pipeline.fetch cada hora.
"""
import sys

from pipeline import leaguepedia, utc_now_iso
from pipeline.fetch import MATCH_FIELDS, RAW_DIR, write_if_changed
from pipeline.history import (CURRENT_YEAR, GAME_FIELDS, LEAGUE_REGIONS, TOURNAMENT_FIELDS, history_files,
                              select_tournaments, worlds_prefix)

YEARS = (2019, 2020, 2021, 2022, 2023, 2024, 2025, CURRENT_YEAR)


def pages_to_fetch(tournaments: list[dict], year: int) -> list[str]:
    """Páginas de torneo a bajar. En el año actual se excluye Worlds."""
    pages = [t["OverviewPage"] for t in tournaments]
    if year == CURRENT_YEAR:
        pages = [p for p in pages if not p.startswith(worlds_prefix(year))]
    return sorted(pages)


def fetch_year(session, year: int, now: str) -> None:
    tournaments = leaguepedia.cargo_query(
        session, tables="Tournaments", fields=TOURNAMENT_FIELDS,
        where=f'Year="{year}" AND ' + leaguepedia.in_clause("League", list(LEAGUE_REGIONS)),
        order_by="OverviewPage",
    )
    selected = select_tournaments(tournaments)
    games = leaguepedia.cargo_query(
        session, tables="ScoreboardGames", fields=GAME_FIELDS,
        where=leaguepedia.in_clause("OverviewPage", pages_to_fetch(selected, year)),
        order_by="DateTime_UTC,GameId",
    )
    tournaments_file, games_file = history_files(RAW_DIR, year)
    write_if_changed(tournaments_file, selected, now)
    write_if_changed(games_file, games, now)
    print(f"{year}: {len(selected)} tournaments, {len(games)} games")

    if year != CURRENT_YEAR:
        # El backtest por serie necesita el formato (Bo1/3/5) de cada partido de Worlds
        matches = leaguepedia.cargo_query(
            session, tables="MatchSchedule", fields=MATCH_FIELDS,
            where=f'OverviewPage LIKE "{worlds_prefix(year)}%"', order_by="DateTime_UTC,MatchId",
        )
        write_if_changed(RAW_DIR / f"worlds_{year}_matches.json", matches, now)
        print(f"{year}: {len(matches)} Worlds matches")


def main() -> None:
    force = "--force" in sys.argv
    now = utc_now_iso()
    session = leaguepedia.make_session()
    for year in YEARS:
        if history_files(RAW_DIR, year)[1].exists() and not force:
            print(f"{year}: already downloaded (use --force to download again)")
            continue
        fetch_year(session, year, now)


if __name__ == "__main__":
    main()
