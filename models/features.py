"""Variables de estilo de equipo y forma por rol para el experimento de notebooks/experiment_variables.ipynb.

Regla de oro: las variables de cada game se arman SOLO con games anteriores. El recorrido es
siempre "primero leer el estado, después actualizarlo con el game".
"""
from math import log
from statistics import mean, pstdev

from models.oracles import ROLES

# Media vida del promedio móvil exponencial: un game de hace 10 games pesa la mitad que el último
HALF_LIFE = 10
ALPHA = 1 - 0.5 ** (1 / HALF_LIFE)

STYLES = ("aggr", "dur", "obj")
# Componentes de cada estilo (columnas de la fila de equipo)
STYLE_PARTS = {"aggr": ("killsat15", "firstblood"), "dur": ("gamelength",),
               "obj": ("firstdragon", "firsttower", "firstherald")}
PLAYER_METRICS = ("golddiffat15", "xpdiffat15", "csdiffat15", "kp", "neg_deaths", "damageshare", "efficiency")
# Columnas que el notebook le pasa a la regresión
STYLE_FEATURES = ("d_aggr", "d_dur", "d_obj", "x_aggr_dur", "x_obj_dur")
ROLE_FEATURES = tuple(f"d_{role}" for role in ROLES)


def _num(row: dict, key: str) -> float | None:
    value = row.get(key)
    if value is None or value == "":
        return None  # dato faltante (ej. la LPL de 2024 y 2025 no trae stats al minuto 15)
    return float(value)


def _player_raw(row: dict) -> dict[str, float | None]:
    kills, deaths, assists = _num(row, "kills"), _num(row, "deaths"), _num(row, "assists")
    team_kills = _num(row, "teamkills")
    dmg, gold = _num(row, "damageshare"), _num(row, "earnedgoldshare")
    return {
        "golddiffat15": _num(row, "golddiffat15"),
        "xpdiffat15": _num(row, "xpdiffat15"),
        "csdiffat15": _num(row, "csdiffat15"),
        # Participación en kills: de las kills del equipo, en cuántas estuvo
        "kp": (kills + assists) / team_kills if team_kills and kills is not None and assists is not None else None,
        "neg_deaths": -deaths if deaths is not None else None,  # signo invertido: más alto = mejor
        "damageshare": dmg,
        # Daño por cada unidad de oro recibido: separa "jugar mal" de "jugar con pocos recursos"
        "efficiency": dmg / gold if dmg is not None and gold else None,
    }


def _team_raw(row: dict) -> dict[str, float | None]:
    return {col: _num(row, col) for parts in STYLE_PARTS.values() for col in parts}


def fit_norms(games: list[dict]) -> dict[tuple[str, str], tuple[float, float]]:
    """Media y desvío de cada métrica: de equipo (scope 'team') y de jugador por rol (scope = rol).

    Normalizar por rol importa: un support con 2 kills es normal y un mid con 2 kills no.
    Se calcula con la temporada de entrenamiento y se aplica igual a todas.
    """
    values: dict[tuple[str, str], list[float]] = {}
    for g in games:
        for side in ("blue", "red"):
            for metric, v in _team_raw(g["teams"][side]).items():
                if v is not None:
                    values.setdefault(("team", metric), []).append(v)
            for role, row in g["players"][side].items():
                for metric, v in _player_raw(row).items():
                    if v is not None:
                        values.setdefault((role, metric), []).append(v)
    return {key: (mean(vs), pstdev(vs) or 1.0) for key, vs in values.items()}


def _z_mean(raw: dict[str, float | None], keys, scope: str, norms) -> float | None:
    """Promedio de los z-scores disponibles (cuántos desvíos por encima del promedio está el valor)."""
    zs = []
    for k in keys:
        if raw.get(k) is not None and (scope, k) in norms:
            mu, sd = norms[(scope, k)]
            zs.append((raw[k] - mu) / sd)
    return mean(zs) if zs else None


class Ewma:
    """Promedio móvil exponencial por clave. Todos arrancan en 0 (= el promedio de la liga): un
    equipo o jugador con pocos games queda cerca del promedio, que es lo prudente con muestras chicas."""

    def __init__(self) -> None:
        self.values: dict[str, float] = {}

    def get(self, key: str) -> float:
        return self.values.get(key, 0.0)

    def update(self, key: str, x: float | None) -> None:
        if x is not None:
            self.values[key] = self.get(key) + ALPHA * (x - self.get(key))


def _player_key(record: dict, side: str, role: str) -> str:
    row = record["players"][side].get(role)
    name = row.get("playername") if row else None
    # Sin nombre no se puede seguir al jugador: clave única que nunca tiene historial
    return f"{role}:{name}" if name else f"{role}:?{record['match_id']}:{side}"


def build_dataset(records: list[dict], norms) -> list[dict]:
    """Una fila por game (vista desde el lado azul) con el Elo y las variables nuevas.

    Todas las variables son antisimétricas: si se dan vuelta los lados, cambian de signo.
    Así el modelo no depende de quién figura como equipo 1; la ventaja del lado azul la
    absorbe el término independiente de la regresión.
    """
    styles = {s: Ewma() for s in STYLES}
    form = Ewma()
    rows = []
    for r in records:
        blue, red = r["blue"], r["red"]
        p = min(max(r["p_blue"], 1e-9), 1 - 1e-9)
        row = {"date": r["date"], "match_id": r["match_id"], "page": r["page"], "region": r["region"],
               "blue": blue, "red": red, "blue_won": r["blue_won"], "p_elo": r["p_blue"],
               "elo_logit": log(p / (1 - p))}

        # 1) Variables con el estado ANTERIOR al game
        s = {name: (styles[name].get(blue), styles[name].get(red)) for name in STYLES}
        for name in STYLES:
            row[f"d_{name}"] = s[name][0] - s[name][1]
        # Interacciones de estilos ("piedra, papel o tijera"): agresividad de uno contra duración del otro
        row["x_aggr_dur"] = s["aggr"][0] * s["dur"][1] - s["aggr"][1] * s["dur"][0]
        row["x_obj_dur"] = s["obj"][0] * s["dur"][1] - s["obj"][1] * s["dur"][0]
        for role in ROLES:
            fb = form.get(_player_key(r, "blue", role))
            fr = form.get(_player_key(r, "red", role))
            row[f"form_blue_{role}"], row[f"form_red_{role}"] = fb, fr
            row[f"d_{role}"] = fb - fr
        rows.append(row)

        # 2) Recién ahora se aprende de este game
        for side, team in (("blue", blue), ("red", red)):
            raw = _team_raw(r["teams"][side])
            for name in STYLES:
                styles[name].update(team, _z_mean(raw, STYLE_PARTS[name], "team", norms))
        _learn_forms(form, r, norms)
    return rows


def _learn_forms(form: Ewma, record: dict, norms) -> None:
    for side in ("blue", "red"):
        for role, prow in record["players"][side].items():
            form.update(_player_key(record, side, role), _z_mean(_player_raw(prow), PLAYER_METRICS, role, norms))


def player_forms(records: list[dict], norms) -> dict[str, float]:
    """Forma de cada jugador después de todos los games (clave 'rol:nombre'), para predecir lo que viene."""
    form = Ewma()
    for r in records:
        _learn_forms(form, r, norms)
    return form.values


def lineups(records: list[dict]) -> dict[str, dict[str, str]]:
    """Última alineación de cada equipo (rol → clave de jugador). Antes de un partido no se sabe quién
    va a jugar: se supone que repite la última, que casi siempre es la titular."""
    result: dict[str, dict[str, str]] = {}
    for r in records:
        for side in ("blue", "red"):
            result[r[side]] = {role: _player_key(r, side, role) for role in r["players"][side]}
    return result
