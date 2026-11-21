"""Build Lattice from verified Scryfall Oracle Cards and All Cards JSONL exports."""
import argparse
from collections import defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil

from build_lookup import key, publish_lookup
from build_printings import write_gzip, write_printing_routes
from build_static_catalog import build as build_static

SOURCE = "https://scryfall.com/docs/api/bulk-data"
TOKEN_LAYOUTS = {"token", "double_faced_token", "emblem"}
STATS = ("power", "toughness", "loyalty", "defense")


def records(path, metadata):
    if path.stat().st_size != metadata["compressed_size"]:
        raise ValueError(f"Unexpected byte size for {path}")
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        for line in stream:
            yield json.loads(line)


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def compact_face(face, type_line=""):
    detail = {"name": face["name"], "type": face.get("type_line") or type_line}
    fields = {
        "manaCost": face.get("mana_cost"),
        "oracleText": face.get("oracle_text"),
        "catalogFaceManaValue": face.get("cmc"),
        **{stat: face.get(stat) for stat in STATS},
    }
    detail.update({field: value for field, value in fields.items() if value is not None and value != ""})
    return detail


def token_record(raw):
    return {
        "name": raw["name"],
        "oracleId": raw["oracle_id"],
        "layout": raw["layout"],
        "faces": [compact_face(face, raw.get("type_line", "")) for face in raw.get("card_faces") or [raw]],
        "isToken": True,
    }


def write_token_catalog(path, tokens, by_set):
    for token in tokens:
        token["setCodes"] = sorted(by_set[token["oracleId"]])
    write_gzip(path, tokens)


def build(dist, catalog_path, print_path, metadata):
    oracle_meta, all_meta = (metadata[name] for name in ("oracle_cards", "all_cards"))
    dates = {entry["updated_at"][:10] for entry in (oracle_meta, all_meta)}
    if len(dates) != 1:
        raise ValueError("Oracle and printing exports must be from the same UTC day")
    snapshot = dates.pop()
    compact = {}
    cards = {}
    tokens = []
    previous = {}
    data = dist / "data"
    for path in data.glob("cards-*.json"):
        for cid, card in json.loads(path.read_text()).items():
            previous[card["oracleId"]] = (int(cid), card)
    next_id = max((cid for cid, _ in previous.values()), default=-1) + 1
    for raw in records(catalog_path, oracle_meta):
        oid = raw.get("oracle_id")
        if not oid:
            if raw["layout"] != "reversible_card":
                raise ValueError(f"Missing Oracle ID for {raw['name']}")
            continue
        if oid in cards:
            raise ValueError(f"Duplicate Oracle ID: {oid}")
        if raw["layout"] in TOKEN_LAYOUTS:
            tokens.append(token_record(raw))
            continue
        if raw["layout"] == "art_series":
            continue
        cid, old = previous.get(oid, (next_id, {}))
        if not old:
            next_id += 1
        faces, concise = [], []
        for face in raw.get("card_faces") or [raw]:
            name, typ = face["name"], face.get("type_line") or raw.get("type_line") or ""
            cost = face.get("mana_cost") or ""
            oracle = face.get("oracle_text") or ""
            mana_value = face.get("cmc")
            lines = oracle.split("\n") if oracle else []
            old_face = next((f for f in old.get("faces", []) if f["name"] == name), {})
            edges = old_face.get("edge", []) if old_face.get("text") == lines else []
            faces.append({
                "name": name, "type": typ, "cost": re.findall(r"\{[^{}]+\}", cost),
                "faceManaValue": mana_value, "text": lines, "edge": edges,
                "keywords": raw.get("keywords", []) if not raw.get("card_faces") else [],
                **{stat: face.get(stat) for stat in STATS},
            })
            concise.append(compact_face(face, raw.get("type_line", "")))
        statuses = defaultdict(list)
        for fmt, status in sorted(raw.get("legalities", {}).items()):
            statuses[status].append(fmt)
        common = {"name": raw["name"], "oracleId": oid, "layout": raw["layout"],
                  "cardColors": raw.get("colors", []), "colorIdentity": raw.get("color_identity", [])}
        if raw.get("cmc") is not None:
            common["catalogManaValue"] = raw["cmc"]
        compact[oid] = {**common, "faces": concise, "legality": dict(statuses)}
        cards[oid] = (cid, {**common, "faces": faces, "snapshotLegality": {"legality": dict(statuses)},
                           "setCodes": []})

    existing_ids = {cid: c for cid,c in cards.values()}
    for _, card in cards.values():
        for face in card["faces"]:
            face["edge"] = [
                edge for edge in face["edge"] if edge["kind"] != "curated" or
                (edge["target"]["card"] in existing_ids and
                 edge["target"]["name"] == existing_ids[edge["target"]["card"]]["name"] and
                 edge["target"]["face"] < len(existing_ids[edge["target"]["card"]]["faces"]))
            ]
    prints_by_set = defaultdict(set)
    by_oracle = defaultdict(set)
    by_set = defaultdict(set)
    set_names = {}
    for raw in records(print_path, all_meta):
        code = raw["set"].upper()
        set_names[code] = raw["set_name"]
        token = raw["layout"] in TOKEN_LAYOUTS
        parents = raw.get("card_faces", []) if raw["layout"] == "reversible_card" else [raw]
        for face in parents:
            oid = face.get("oracle_id")
            if not oid:
                continue
            row = (raw["id"], oid, code, raw["collector_number"], raw["lang"],
                   face.get("printed_name") or face.get("flavor_name") or face["name"],
                   ", ".join(raw.get("finishes", [])), int(token))
            ids = raw.get("multiverse_ids")
            if ids:
                row += (ids[0],)
            prints_by_set[code].add(row)
            if not token:
                by_oracle[oid[:2]].add(row)
            by_set[oid].add(code)

    # Rebuild generated directories to clear routes removed from this snapshot.
    for name in ("cards", "lookup"):
        if (dist / name).exists():
            shutil.rmtree(dist / name)
    for path in data.glob("cards-*.json"):
        path.unlink()
    printings = data / "printings"
    printings.mkdir(exist_ok=True)
    for path in printings.glob("*.json.gz"):
        path.unlink()
    for prefix, rows in sorted(by_oracle.items()):
        write_gzip(printings / f"oracle-{prefix}.json.gz", sorted(rows))
    for code, rows in sorted(prints_by_set.items()):
        write_gzip(printings / f"set-{code.lower()}.json.gz", sorted(rows))
    print_count = sum(map(len, prints_by_set.values()))
    with print_path.open("rb") as stream:
        print_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    save(printings / "meta.json", {
        "snapshot": snapshot, "source": SOURCE, "download": all_meta["jsonl_download_uri"],
        "updatedAt": all_meta["updated_at"], "count": print_count, "setShards": sorted(prints_by_set),
        "sha256": print_hash, "setNames": set_names,
        "idSetShards": write_printing_routes(printings, prints_by_set),
    })

    write_token_catalog(data / "tokens.json.gz", tokens, by_set)

    lookup = defaultdict(lambda: defaultdict(list))
    shards = defaultdict(dict)
    index, search = [], []
    for oid, (cid, card) in sorted(cards.items(), key=lambda item: item[1][0]):
        card["setCodes"] = sorted(by_set[oid])
        types = list(dict.fromkeys(
            kind for face in card["faces"] for kind in face["type"].split(" — ", 1)[0].split()
        ))
        index.append([cid, card["name"], oid, types])
        search.append([cid, " ".join(word for f in card["faces"] for word in f["text"] + f["keywords"])])
        shards[cid // 128][cid] = card
        name_key = key(card["name"])
        lookup[name_key[:4]][name_key].append(compact[oid])
    for bucket, shard in shards.items():
        save(data / f"cards-{bucket}.json", shard)
    save(data / "index.json", index)
    save(data / "oracle.json", search)
    with catalog_path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    save(data / "meta.json", {
        "cards": len(cards), "faces": sum(len(c["faces"]) for _, c in cards.values()),
        "sets": sum(len(card["setCodes"]) for _, card in cards.values()), "snapshot": snapshot,
        "source": SOURCE, "download": oracle_meta["jsonl_download_uri"], "sha256": digest,
    })
    publish_lookup(dist, lookup, len(cards), snapshot, oracle_meta["updated_at"], SOURCE, digest)
    build_static(dist)
    print(f"{print_count:,} print records; {len(previous.keys() - cards.keys()):,} previous Oracle IDs absent")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("metadata", "oracle_cards", "all_cards", "dist"):
        parser.add_argument(field, type=Path)
    args = parser.parse_args()
    metadata = {row["type"]: row for row in json.loads(args.metadata.read_text())["data"]}
    build(args.dist, args.oracle_cards, args.all_cards, metadata)
