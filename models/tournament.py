"""El torneo completo, para los pick'ems: camino más probable y simulación de Monte Carlo.

Dos preguntas distintas:
- Camino más probable (chalk): en cada partido gana el favorito y así se arma el resto del bracket.
  Da un pick por partido, que es lo que se carga en un pick'em.
- Monte Carlo: se juega el torneo N veces sorteando cada serie con la probabilidad del modelo y se cuenta
  cuántas veces pasa cada cosa ("3-0 en 3.800 de 10.000 torneos" → 38%). Con N = 10.000 el error estándar
  de cada porcentaje es √(p(1−p)/N), como mucho medio punto.

Supuestos: las series son independientes entre sí; los ratings no cambian dentro de una simulación; los
sorteos de la suiza y de cuartos son al azar, sin repetir cruces (las reglas exactas de Riot no están en
los datos). Los partidos ya jugados y los cruces ya publicados se respetan.
"""
import random
from collections import Counter
from collections.abc import Callable

from models.elo import series_probability

SIMULATIONS = 10_000
SEED = 2026  # semilla fija: con los mismos datos sale el mismo JSON (el cron no genera commits de ruido)
SWISS_ROUNDS = 5
TO_ADVANCE = 3  # 3 victorias clasifican, 3 derrotas eliminan
PAIRING_TRIES = 50

# Fuente de cada lado de un partido: ("W" o "L", partido) = ganador o perdedor de ese partido
PLAYIN_PREFIX = "Play-In_"
PLAYIN_BRACKET = {  # doble eliminación de 4 equipos; pasa solo el campeón
    "Round 1_1": None,
    "Round 1_2": None,
    "Round 2_1": (("W", "Round 1_1"), ("W", "Round 1_2")),  # final de ganadores
    "Round 1_3": (("L", "Round 1_1"), ("L", "Round 1_2")),  # partido de perdedores
    "Round 2_2": (("L", "Round 2_1"), ("W", "Round 1_3")),  # final de perdedores
    "Round 3_1": (("W", "Round 2_1"), ("W", "Round 2_2")),  # gran final
}
PLAYIN_LABELS = {
    "Round 1_1": "Semi 1", "Round 1_2": "Semi 2", "Round 2_1": "Final de ganadores",
    "Round 1_3": "Partido de perdedores", "Round 2_2": "Final de perdedores", "Round 3_1": "Gran final",
}
PLAYIN_FINAL = "Round 3_1"

KNOCKOUT_PREFIX = "Main Event_"
KNOCKOUT_BRACKET = {
    "Quarterfinals_1": None, "Quarterfinals_2": None, "Quarterfinals_3": None, "Quarterfinals_4": None,
    "Semifinals_1": (("W", "Quarterfinals_1"), ("W", "Quarterfinals_2")),
    "Semifinals_2": (("W", "Quarterfinals_3"), ("W", "Quarterfinals_4")),
    "Finals_1": (("W", "Semifinals_1"), ("W", "Semifinals_2")),
}
KNOCKOUT_LABELS = {
    "Quarterfinals_1": "Cuartos 1", "Quarterfinals_2": "Cuartos 2", "Quarterfinals_3": "Cuartos 3",
    "Quarterfinals_4": "Cuartos 4", "Semifinals_1": "Semi 1", "Semifinals_2": "Semi 2", "Finals_1": "Final",
}

SeriesProb = Callable[[str, str, int], float]  # (equipo 1, equipo 2, best_of) → chance de que gane el 1


def series_model(game_prob: Callable[[str, str], float]) -> SeriesProb:
    """De "chance por partida" a "chance de ganar la serie", con cache: la simulación pide los mismos
    cruces miles de veces."""
    cache: dict[tuple[str, str, int], float] = {}

    def prob(team1: str, team2: str, best_of: int) -> float:
        key = (team1, team2, best_of)
        if key not in cache:
            cache[key] = series_probability(game_prob(team1, team2), best_of)
        return cache[key]
    return prob


def key_of(match_id: str, prefix: str) -> str | None:
    """'.../Play-In_Round 1_1' → 'Round 1_1'."""
    return match_id.split(prefix, 1)[1] if prefix in match_id else None


def _team(m: dict, side: str) -> str | None:
    return m[side]["name"] if m.get(side) else None


def _real_winner(m: dict) -> str | None:
    return _team(m, m["winner"]) if m.get("status") == "finished" and m.get("winner") else None


# ---------- Brackets (Play-In y eliminatorias) ----------

def play_bracket(matches: dict[str, dict], bracket: dict, decide: Callable[[str, str, int], str]) -> dict[str, dict]:
    """Juega un bracket en orden. Usa equipos y resultados reales cuando existen; si no, los equipos salen
    de los partidos que alimentan a cada uno y el ganador lo elige `decide(equipo1, equipo2, best_of)`.

    Devuelve por partido: team1, team2, winner, loser y si los equipos son reales o proyectados.
    """
    played: dict[str, dict] = {}
    for key, sources in bracket.items():
        m = matches.get(key, {})
        real1, real2 = _team(m, "team1"), _team(m, "team2")
        projected = not (real1 and real2)
        if projected and sources:
            def pick(source):
                outcome, feeder = source
                result = played.get(feeder) or {}
                return result.get("winner" if outcome == "W" else "loser")
            # Leaguepedia ubica al equipo ya clasificado en cualquiera de los dos lados (ej. el ganador de la
            # Semi 1 puede aparecer como team2), así que el lado vacío se llena con el candidato que no está
            candidates = [pick(s) for s in sources]
            if real1 and not real2:
                real2 = next((c for c in candidates if c != real1), None)
            elif real2 and not real1:
                real1 = next((c for c in candidates if c != real2), None)
            elif not real1 and not real2:
                real1, real2 = candidates
        winner = _real_winner(m)
        if not winner and real1 and real2:
            winner = decide(real1, real2, m.get("best_of", 5))
        loser = (real2 if winner == real1 else real1) if winner else None
        played[key] = {"team1": real1, "team2": real2, "winner": winner, "loser": loser, "projected": projected}
    return played


def chalk(prob: SeriesProb) -> Callable[[str, str, int], str]:
    """Camino más probable: gana el favorito (con 50% exacto, el equipo 1, como en las predicciones)."""
    return lambda t1, t2, bo: t1 if prob(t1, t2, bo) >= 0.5 else t2


def sampler(prob: SeriesProb, rng: random.Random) -> Callable[[str, str, int], str]:
    """Monte Carlo: gana el equipo 1 con su probabilidad."""
    return lambda t1, t2, bo: t1 if rng.random() < prob(t1, t2, bo) else t2


# ---------- Suiza ----------

def _pair(teams: list[str], met: dict[str, set], rng: random.Random) -> list[tuple[str, str]]:
    """Empareja al azar sin repetir cruces. Si no lo logra en varios intentos, acepta una revancha
    (con 16 equipos y 5 rondas casi nunca hace falta)."""
    for _ in range(PAIRING_TRIES):
        pool = teams[:]
        rng.shuffle(pool)
        pairs = []
        while pool:
            a = pool.pop()
            rival = next((b for b in pool if b not in met[a]), None)
            if rival is None:
                break
            pool.remove(rival)
            pairs.append((a, rival))
        else:
            return pairs
    pool = teams[:]
    rng.shuffle(pool)
    return list(zip(pool[::2], pool[1::2]))


def play_swiss(teams: list[str], rounds: dict[int, list[dict]], decide, rng: random.Random,
               observe: Callable[[int, dict[str, tuple[int, int]]], None] | None = None) -> dict[str, list[int]]:
    """Juega las 5 rondas. Respeta los cruces publicados y los resultados reales; el resto se sortea entre
    equipos con el mismo récord. Devuelve {equipo: [victorias, derrotas]}.

    `observe(ronda, récords)` recibe, antes de cada ronda, el récord de los equipos que siguen en juego.
    """
    record = {t: [0, 0] for t in teams}
    met: dict[str, set] = {t: set() for t in teams}
    alive = lambda t: record[t][0] < TO_ADVANCE and record[t][1] < TO_ADVANCE  # noqa: E731

    def play(a: str, b: str, best_of: int, winner: str | None = None) -> None:
        winner = winner or decide(a, b, best_of)
        loser = b if winner == a else a
        record[winner][0] += 1
        record[loser][1] += 1
        met[a].add(b)
        met[b].add(a)

    for n in range(1, SWISS_ROUNDS + 1):
        if observe:
            observe(n, {t: (record[t][0], record[t][1]) for t in teams if alive(t)})
        fixed = set()
        for m in rounds.get(n, []):
            a, b = _team(m, "team1"), _team(m, "team2")
            if a in record and b in record and alive(a) and alive(b):
                play(a, b, m["best_of"], _real_winner(m))
                fixed |= {a, b}
        # El resto, sorteado por récord; si un grupo queda impar, el que sobra baja al grupo siguiente
        groups: dict[tuple[int, int], list[str]] = {}
        for t in teams:
            if alive(t) and t not in fixed:
                groups.setdefault(tuple(record[t]), []).append(t)
        carry: list[str] = []
        for rec in sorted(groups, key=lambda r: (-r[0], r[1])):
            group = carry + groups[rec]
            carry = [group.pop()] if len(group) % 2 else []
            for a, b in _pair(group, met, rng):
                # Bo3 si la serie clasifica o elimina a alguien; si no, Bo1
                decisive = TO_ADVANCE - 1 in (record[a][0], record[a][1], record[b][0], record[b][1])
                play(a, b, 3 if decisive else 1)
    return record


# ---------- Torneo completo ----------

def _swiss_rounds(schedule: list[dict]) -> dict[int, list[dict]]:
    rounds: dict[int, list[dict]] = {}
    for m in schedule:
        if m["phase"] == "swiss" and m["round"].split()[-1].isdigit():
            rounds.setdefault(int(m["round"].split()[-1]), []).append(m)
    return rounds


def _by_key(schedule: list[dict], prefix: str) -> dict[str, dict]:
    return {k: m for m in schedule if (k := key_of(m["id"], prefix))}


def simulate(schedule: list[dict], main_teams: list[str], prob: SeriesProb,
             n: int = SIMULATIONS, seed: int = SEED) -> dict[str, Counter]:
    """Juega el torneo n veces. `main_teams` son los clasificados directo a la suiza (sin el del Play-In).

    Devuelve contadores por resultado: playin, swiss_3_0, swiss_advance, swiss_0_3, semis, final, champion;
    además swiss_round[(ronda, victorias, derrotas, equipo)] (récord al empezar cada ronda) y
    swiss_final[(victorias, derrotas, equipo)] (récord final).
    """
    rng = random.Random(seed)
    decide = sampler(prob, rng)
    playin = _by_key(schedule, PLAYIN_PREFIX)
    knockout = _by_key(schedule, KNOCKOUT_PREFIX)
    rounds = _swiss_rounds(schedule)
    counts = {k: Counter() for k in ("playin", "swiss_3_0", "swiss_advance", "swiss_0_3", "semis", "final", "champion",
                                     "swiss_round", "swiss_final")}

    def observe(round_n: int, records: dict[str, tuple[int, int]]) -> None:
        for t, (w, l) in records.items():
            counts["swiss_round"][(round_n, w, l, t)] += 1

    for _ in range(n):
        teams = list(main_teams)
        if playin:
            qualifier = play_bracket(playin, PLAYIN_BRACKET, decide)[PLAYIN_FINAL]["winner"]
            counts["playin"][qualifier] += 1
            if qualifier not in teams:
                teams.append(qualifier)
        record = play_swiss(teams, rounds, decide, rng, observe)
        for t, (w, l) in record.items():
            counts["swiss_final"][(w, l, t)] += 1
        advanced = [t for t, (w, _) in record.items() if w >= TO_ADVANCE]
        for t, (w, l) in record.items():
            if w >= TO_ADVANCE:
                counts["swiss_advance"][t] += 1
                if l == 0:
                    counts["swiss_3_0"][t] += 1
            elif l >= TO_ADVANCE and w == 0:
                counts["swiss_0_3"][t] += 1
        # Cuartos: los cruces publicados si están; si no, sorteo al azar entre los 8
        known = all(_team(knockout.get(k, {}), "team1") for k in ("Quarterfinals_1", "Quarterfinals_2",
                                                                  "Quarterfinals_3", "Quarterfinals_4"))
        if known:
            bracket_matches = knockout
        else:
            draw = advanced[:]
            rng.shuffle(draw)
            bracket_matches = {f"Quarterfinals_{i + 1}": {"team1": {"name": draw[2 * i]}, "team2": {"name": draw[2 * i + 1]},
                                                         "best_of": 5} for i in range(len(draw) // 2)}
            bracket_matches |= {k: m for k, m in knockout.items() if not k.startswith("Quarterfinals")}
        result = play_bracket(bracket_matches, KNOCKOUT_BRACKET, decide)
        for key in ("Semifinals_1", "Semifinals_2"):
            for side in ("team1", "team2"):
                if result[key][side]:
                    counts["semis"][result[key][side]] += 1
        for side in ("team1", "team2"):
            if result["Finals_1"][side]:
                counts["final"][result["Finals_1"][side]] += 1
        if result["Finals_1"]["winner"]:
            counts["champion"][result["Finals_1"]["winner"]] += 1
    return counts


def chalk_bracket(matches: dict[str, dict], bracket: dict, labels: dict, prob: SeriesProb) -> list[dict]:
    """Bracket del camino más probable, listo para exportar: equipos, chance del equipo 1 y pick."""
    played = play_bracket(matches, bracket, chalk(prob))
    rows = []
    for key in bracket:
        m, p = matches.get(key, {}), played[key]
        t1, t2 = p["team1"], p["team2"]
        finished = _real_winner(m) is not None
        rows.append({
            "id": m.get("id"), "key": key, "label": labels[key], "start_utc": m.get("start_utc"), "best_of": m.get("best_of", 5),
            "team1": t1, "team2": t2,
            "p_team1": round(prob(t1, t2, m.get("best_of", 5)), 4) if t1 and t2 else None,
            "pick": ("team1" if p["winner"] == t1 else "team2") if p["winner"] else None,
            "status": "finished" if finished else "projected" if p["projected"] else "scheduled",
            "score": m.get("score") if finished else None,
        })
    return rows


FINAL_RECORDS = [(3, 0), (3, 1), (3, 2), (0, 3), (1, 3), (2, 3)]
MIN_SHARE = 0.005  # en las cajas no se listan los equipos con menos de medio punto de chance


def swiss_structure(counts: dict[str, Counter], n: int, short: Callable[[str], str]) -> dict:
    """La suiza en el formato de lolesports, con probabilidades: por ronda, una caja por récord con la chance de
    cada equipo de empezar esa ronda con ese récord; al final, la chance de cada récord final (3-0 … 2-3)."""
    def teams(entries: dict[str, int]) -> list[dict]:
        out = [{"name": t, "short": short(t), "p": round(c / n, 4)} for t, c in entries.items() if c / n >= MIN_SHARE]
        return sorted(out, key=lambda r: (-r["p"], r["short"]))

    boxes: dict[tuple[int, int, int], dict[str, int]] = {}
    for (round_n, w, l, t), c in counts["swiss_round"].items():
        boxes.setdefault((round_n, w, l), {})[t] = c
    rounds = []
    for round_n in range(1, SWISS_ROUNDS + 1):
        records = sorted({(w, l) for (r, w, l) in boxes if r == round_n}, key=lambda x: (-x[0], x[1]))
        rounds.append({"round": round_n, "groups": [{
            "record": f"{w}-{l}",
            "best_of": 3 if TO_ADVANCE - 1 in (w, l) else 1,
            "expected": round(sum(boxes[(round_n, w, l)].values()) / n, 2),  # cuántos equipos hay en promedio
            "teams": teams(boxes[(round_n, w, l)]),
        } for w, l in records]})
    final: dict[tuple[int, int], dict[str, int]] = {}
    for (w, l, t), c in counts["swiss_final"].items():
        final.setdefault((w, l), {})[t] = c
    return {"rounds": rounds,
            "final": [{"record": f"{w}-{l}", "teams": teams(final.get((w, l), {}))} for w, l in FINAL_RECORDS]}


def payload(schedule: list[dict], main_teams: list[str], prob: SeriesProb, short: Callable[[str], str],
            n: int = SIMULATIONS, seed: int = SEED) -> dict:
    """tournament.json: brackets del camino más probable + chances por equipo (en proporción, 0 a 1)."""
    counts = simulate(schedule, main_teams, prob, n, seed)
    team = lambda name: {"name": name, "short": short(name)} if name else None  # noqa: E731
    share = lambda counter, name: round(counter[name] / n, 4)  # noqa: E731

    def rows(names, fields, order):
        """Una fila por equipo; ordenadas por `order` y, si empatan, por las demás columnas (de la última a la primera)."""
        out = [{"name": t, "short": short(t), **{f: share(counts[c], t) for f, c in fields.items()}} for t in names]
        tiebreak = [order] + [f for f in reversed(fields) if f != order]
        return sorted(out, key=lambda r: (*(-r[f] for f in tiebreak), r["short"]))

    def bracket(prefix, structure, labels):
        out = chalk_bracket(_by_key(schedule, prefix), structure, labels, prob)
        return [{**r, "team1": team(r["team1"]), "team2": team(r["team2"])} for r in out]

    playin = _by_key(schedule, PLAYIN_PREFIX)
    playin_teams = sorted({t for m in playin.values() for t in (_team(m, "team1"), _team(m, "team2")) if t})
    everyone = sorted(set(main_teams) | set(playin_teams))
    quarters_known = all(_team(_by_key(schedule, KNOCKOUT_PREFIX).get(f"Quarterfinals_{i}", {}), "team1")
                         for i in range(1, 5))
    return {
        "simulations": n,
        "playin": {
            "bracket": bracket(PLAYIN_PREFIX, PLAYIN_BRACKET, PLAYIN_LABELS),
            "teams": rows(playin_teams, {"p_win": "playin"}, "p_win"),
        },
        "swiss": {"teams": rows(everyone, {"p_3_0": "swiss_3_0", "p_advance": "swiss_advance",
                                           "p_0_3": "swiss_0_3"}, "p_advance"),
                  **swiss_structure(counts, n, short)},
        "knockout": {
            # Picks por partido recién cuando se publiquen los cuartos (antes los cruces son un sorteo)
            "bracket": bracket(KNOCKOUT_PREFIX, KNOCKOUT_BRACKET, KNOCKOUT_LABELS) if quarters_known else [],
            "teams": rows(everyone, {"p_semis": "semis", "p_final": "final", "p_champion": "champion"}, "p_champion"),
        },
    }
