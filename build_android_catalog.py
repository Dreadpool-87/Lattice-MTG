"""Publish versioned, compressed offline card packs from the site's snapshots."""
import gzip
import hashlib
import json
from pathlib import Path
import re

from build_printings import write_gzip


def read_gzip(path):
    with gzip.open(path, "rt", encoding="utf-8") as source:
        return json.load(source)


def face_record(face):
    return {
        "name": face["name"], "mana_cost": face.get("manaCost", "".join(face.get("cost", []))),
        "type_line": face["type"], "oracle_text": face.get("oracleText", "\n".join(face.get("text", []))),
        **{key: face[key] for key in ("power", "toughness", "loyalty") if face.get(key) is not None},
    }


def publish(dist):
    data = dist / "data"
    meta = json.loads((data / "printings" / "meta.json").read_text(encoding="utf-8"))
    catalog_meta = json.loads((data / "meta.json").read_text(encoding="utf-8"))
    cards = {
        card["oracleId"]: card
        for path in sorted(data.glob("cards-*.json"))
        for card in json.loads(path.read_text(encoding="utf-8")).values()
    }
    cards.update({card["oracleId"]: card for card in read_gzip(data / "tokens.json.gz")})
    out = data / "android"
    out.mkdir(exist_ok=True)

    def make_row(printing):
        printing_id, oracle_id, code, number, lang, _, *_ = printing
        card = cards[oracle_id]
        faces = [face_record(face) for face in card["faces"]]
        return {
            "id": printing_id, "oracle_id": oracle_id,
            "set": code.lower(), "set_name": meta["setNames"][code],
            "collector_number": number, "lang": lang.lower(), "cmc": card.get("catalogManaValue", 0),
            "colors": card.get("cardColors", []), "color_identity": card.get("colorIdentity", []),
            "keywords": sorted({word for face in card["faces"] for word in face.get("keywords", [])}),
            "legalities": {fmt: status for status, formats in
                          card.get("snapshotLegality", {}).get("legality", {}).items() for fmt in formats},
            "rarity": "unknown",
            **(faces[0] if len(faces) == 1 else {
                "type_line": " // ".join(face["type_line"] for face in faces), "card_faces": faces,
            }),
            "name": card["name"],
        }

    def save_pack(key, name, printings):
        rows = list({row[0]: make_row(row) for row in printings}.values())
        if not rows:
            raise ValueError(f"Empty Android pack: {key}")
        path = out / f"{key}.json.gz"
        write_gzip(path, rows)
        return {"id": key, "name": name, "count": len(rows), "bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}

    def rank(row):
        return row[4] != "en", row[2], row[3], row[0]

    all_cards = {}
    packs = []
    for code in meta["setShards"]:
        slug = code.lower()
        if not re.fullmatch(r"[a-z0-9]+", slug):
            raise ValueError(f"Invalid set code: {code}")
        selected = {}
        for row in read_gzip(data / "printings" / f"set-{slug}.json.gz"):
            if row[1] not in cards:
                continue
            for index, key in ((selected, (row[1], row[3])), (all_cards, row[1])):
                if key not in index or rank(row) < rank(index[key]):
                    index[key] = row
        if selected:
            packs.append(save_pack(f"set-{slug}", meta["setNames"][code], selected.values()))

    missing = set(cards) - all_cards.keys()
    if missing:
        raise ValueError(f"{len(missing)} cards lack a printing in the Android catalog")
    packs.insert(0, save_pack("all", "All cards", all_cards.values()))
    manifest = {"schema": 1, "snapshot": max(meta["snapshot"], catalog_meta["snapshot"]),
                "packs": packs}
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Android catalog: {packs[0]['count']:,} cards, {len(packs)-1:,} sets")


if __name__ == "__main__":
    publish(Path(__file__).resolve().parent / "dist")
