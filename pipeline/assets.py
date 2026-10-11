"""Imágenes del sitio: logos de equipos (Leaguepedia) e íconos de campeones (Data Dragon de Riot).

Uso: python -m pipeline.assets (también lo llama pipeline.fetch al final).
- Logos: se bajan una sola vez, en 128 px, a web/public/img/teams/<id>.png y se commitean.
  Leaguepedia tiene rate limit: solo se piden los equipos que todavía no tienen logo.
- Campeones: se guarda el mapa nombre → id de Data Dragon para la versión del parche de Worlds.
  Las imágenes no se descargan: el sitio las carga del CDN de Riot (Data Dragon existe para eso).
"""
import json
from pathlib import Path

import requests
from PIL import Image

from pipeline import leaguepedia, utc_now_iso
from pipeline.meta import WORLDS_PATCH
from pipeline.stats import slug

RAW_DIR = Path("data/raw")
TEAMS_FILE = RAW_DIR / "worlds_2026_teams.json"
DDRAGON_FILE = RAW_DIR / "ddragon_champions.json"
LOGO_DIR = Path("web/public/img/teams")
LOGO_WIDTH = 128
DDRAGON_URL = "https://ddragon.leagueoflegends.com"
TIMEOUT_S = 30
TITLES_PER_QUERY = 50  # máximo de títulos por consulta de la API de MediaWiki
# Logo "oscuro": casi todos sus píxeles visibles son negros o muy oscuros. Sobre el fondo del sitio no se
# vería, así que se pasa a blanco (la versión monocromática que usan los equipos sobre fondos oscuros).
DARK_PIXEL_MAX = 80      # un píxel es oscuro si su canal más brillante (0-255) no llega a esto
DARK_LOGO_SHARE = 0.9    # proporción de píxeles oscuros desde la que el logo se aclara
LIGHT_RGB = (245, 247, 252)  # --fg del sitio


# ---------- Logos de equipos ----------

def logo_path(team_name: str, logo_dir: Path = LOGO_DIR) -> Path:
    """Archivo del logo: mismo id que usa la URL del equipo ('Gen.G' → gen-g.png)."""
    return logo_dir / f"{slug(team_name)}.png"


def logo_url(team_name: str, logo_dir: Path = LOGO_DIR) -> str | None:
    """Ruta relativa que usa el sitio, o None si el equipo todavía no tiene logo."""
    path = logo_path(team_name, logo_dir)
    return f"img/teams/{path.name}" if path.exists() else None


def missing_logos(team_names: list[str], logo_dir: Path = LOGO_DIR) -> list[str]:
    return [n for n in team_names if not logo_path(n, logo_dir).exists()]


def dark_share(image: Image.Image) -> float:
    """Proporción de píxeles visibles (no transparentes) que son oscuros."""
    visible = [p for p in image.convert("RGBA").getdata() if p[3] > 128]
    if not visible:
        return 0.0
    return sum(max(p[:3]) < DARK_PIXEL_MAX for p in visible) / len(visible)


def lighten_if_dark(path: Path) -> bool:
    """Pasa a blanco un logo negro (conserva la transparencia). Devuelve True si lo cambió."""
    image = Image.open(path).convert("RGBA")
    if dark_share(image) < DARK_LOGO_SHARE:
        return False
    alpha = image.getchannel("A")
    light = Image.new("RGBA", image.size, (*LIGHT_RGB, 255))
    light.putalpha(alpha)
    light.save(path)
    return True


def thumb_urls(payload: dict) -> dict[str, str]:
    """Respuesta de prop=imageinfo → {'File:X.png': url de la miniatura}.

    MediaWiki normaliza los títulos (guiones bajos → espacios, mayúscula inicial) y los
    devuelve aparte en 'normalized': se traducen de vuelta al título que pedimos.
    """
    query = payload.get("query", {})
    back = {n["to"]: n["from"] for n in query.get("normalized", [])}
    urls = {}
    for page in query.get("pages", {}).values():
        info = (page.get("imageinfo") or [{}])[0]
        url = info.get("thumburl") or info.get("url")
        if url:
            urls[back.get(page["title"], page["title"])] = url
    return urls


def square_title(team_name: str) -> str:
    """Logo cuadrado de Leaguepedia: solo el ícono, sin el nombre escrito (se lee mejor en chico)."""
    return f"File:{team_name}logo square.png"


def _fetch_thumbs(session, titles: list[str]) -> dict[str, str]:
    urls: dict[str, str] = {}
    for i in range(0, len(titles), TITLES_PER_QUERY):
        payload = leaguepedia.api_get(session, {
            "action": "query", "prop": "imageinfo", "iiprop": "url",
            "iiurlwidth": LOGO_WIDTH, "titles": "|".join(titles[i:i + TITLES_PER_QUERY]),
        })
        urls.update(thumb_urls(payload))
    return urls


def fetch_logos(session, team_names: list[str], logo_dir: Path = LOGO_DIR) -> int:
    """Baja los logos que faltan. Devuelve cuántos guardó."""
    missing = missing_logos(team_names, logo_dir)
    if not missing:
        return 0
    files = {name: square_title(name) for name in missing}
    urls = _fetch_thumbs(session, sorted(set(files.values())))
    # Si no hay versión cuadrada, el logo que figura en la tabla Teams (suele traer el nombre escrito)
    fallback = [n for n in missing if files[n] not in urls]
    if fallback:
        rows = leaguepedia.cargo_query(session, tables="Teams", fields="Name,Image",
                                       where=leaguepedia.in_clause("Name", fallback))
        files.update({r["Name"]: f"File:{r['Image']}" for r in rows if r.get("Image")})
        urls.update(_fetch_thumbs(session, sorted({files[n] for n in fallback})))
    logo_dir.mkdir(parents=True, exist_ok=True)
    saved = 0
    for name, title in files.items():
        if title not in urls:
            continue
        # El CDN de Fandom bloquea pedidos que no vienen de la wiki (403): se manda la wiki como Referer
        response = session.get(urls[title], headers={"Referer": "https://lol.fandom.com/"}, timeout=TIMEOUT_S)
        response.raise_for_status()
        path = logo_path(name, logo_dir)
        path.write_bytes(response.content)
        lighten_if_dark(path)
        saved += 1
    return saved


# ---------- Íconos de campeones ----------

def ddragon_version(versions: list[str], patch: str) -> str:
    """Versión de Data Dragon del parche ('16.20' → '16.20.1'); si todavía no salió, la más nueva."""
    return next((v for v in versions if v.startswith(f"{patch}.")), versions[0])


def champion_ids(champion_json: dict) -> dict[str, str]:
    """Nombre visible → id de la imagen ('Wukong' → 'MonkeyKing'). Hay que usar el archivo en inglés:
    Oracle's Elixir usa los nombres en inglés y en español algunos cambian ('Bard' → 'Bardo')."""
    return {c["name"]: c["id"] for c in champion_json["data"].values()}


def fetch_champions(session, patch: str = WORLDS_PATCH, path: Path = DDRAGON_FILE) -> bool:
    """Guarda {fetched_at, version, ids} si cambió la versión. Devuelve True si escribió."""
    versions = session.get(f"{DDRAGON_URL}/api/versions.json", timeout=TIMEOUT_S).json()
    version = ddragon_version(versions, patch)
    if path.exists() and json.loads(path.read_text(encoding="utf-8")).get("version") == version:
        return False
    data = session.get(f"{DDRAGON_URL}/cdn/{version}/data/en_US/champion.json", timeout=TIMEOUT_S).json()
    payload = {"fetched_at": utc_now_iso(), "version": version, "ids": champion_ids(data)}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return True


def champion_icons(path: Path = DDRAGON_FILE) -> dict | None:
    """Lo que exporta champions.json para armar las URLs: {base, ids}. None si no hay caché."""
    if not path.exists():
        return None
    cached = json.loads(path.read_text(encoding="utf-8"))
    return {"base": f"{DDRAGON_URL}/cdn/{cached['version']}/img/champion/", "ids": cached["ids"]}


def main(session=None) -> None:
    session = session or leaguepedia.make_session()
    teams = [t["Name"] for t in json.loads(TEAMS_FILE.read_text(encoding="utf-8"))["rows"]]
    print(f"team logos: {fetch_logos(session, teams)} new")
    # Data Dragon es de Riot, no de Leaguepedia: sesión aparte, sin el login
    print(f"champion icons: {'updated' if fetch_champions(requests.Session()) else 'unchanged'}")


if __name__ == "__main__":
    main()
