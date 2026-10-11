from PIL import Image

from pipeline import assets


def test_ddragon_version_matches_the_patch_or_falls_back_to_latest():
    versions = ["16.21.1", "16.20.1", "16.19.1"]
    assert assets.ddragon_version(versions, "16.20") == "16.20.1"
    # Parche que Data Dragon todavía no publicó: la más nueva
    assert assets.ddragon_version(versions, "16.22") == "16.21.1"


def test_champion_ids_maps_display_names_to_image_ids():
    data = {"data": {"MonkeyKing": {"id": "MonkeyKing", "name": "Wukong"}, "Ahri": {"id": "Ahri", "name": "Ahri"}}}
    assert assets.champion_ids(data) == {"Wukong": "MonkeyKing", "Ahri": "Ahri"}


def test_thumb_urls_translates_normalized_titles_back():
    payload = {"query": {
        "normalized": [{"from": "File:Gen.Glogo_square.png", "to": "File:Gen.Glogo square.png"}],
        "pages": {
            "1": {"title": "File:Gen.Glogo square.png", "imageinfo": [{"url": "full", "thumburl": "thumb"}]},
            "-1": {"title": "File:Missing.png", "missing": ""},
        },
    }}
    assert assets.thumb_urls(payload) == {"File:Gen.Glogo_square.png": "thumb"}


def test_logo_url_only_when_the_file_exists(tmp_path):
    assert assets.logo_url("Gen.G", tmp_path) is None
    (tmp_path / "gen-g.png").write_bytes(b"png")
    assert assets.logo_url("Gen.G", tmp_path) == "img/teams/gen-g.png"
    assert assets.missing_logos(["Gen.G", "T1"], tmp_path) == ["T1"]


def test_lighten_if_dark_whitens_black_logos_and_keeps_colored_ones(tmp_path):
    black = tmp_path / "black.png"
    Image.new("RGBA", (4, 4), (10, 10, 10, 255)).save(black)
    red = tmp_path / "red.png"
    Image.new("RGBA", (4, 4), (227, 0, 19, 255)).save(red)  # rojo de T1: oscuro en luminancia, pero no negro
    assert assets.lighten_if_dark(black) is True
    assert Image.open(black).convert("RGBA").getpixel((0, 0)) == (*assets.LIGHT_RGB, 255)
    assert assets.lighten_if_dark(red) is False
