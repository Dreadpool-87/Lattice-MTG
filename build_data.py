"""Build a lightweight index and on-demand card shards from Lattice JSON."""
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path


def build(source, output):
    raw = source.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != "204fe30fe6c1b89ab06909edd45b4c742aa5ee3d1ca5e17bee7c2e15e2118633":
        raise ValueError("Unexpected corpus snapshot")
    pack = json.loads(raw)
    output.mkdir(parents=True, exist_ok=True)

    def save(name, value):
        (output / (name + ".json")).write_text(
            json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )

    text = {row[0]: row[2] for row in pack["atoms"]}
    faces = {row[0]: row for row in pack["faces"]}
    cards = {row[0]: row for row in pack["cards"]}
    names = {cid: " // ".join(text[faces[fid][3]] for fid in row[3]) for cid, row in cards.items()}
    sets = defaultdict(list)
    edges = defaultdict(list)
    for _, cid, aid in pack["prints"]:
        sets[cid].append(text[aid])
    for fid, kind, target, *note in pack["edges"]:
        if kind == "curated":
            other = faces[int(target[2:])]
            pair = {cards[faces[fid][1]][1], cards[other[1]][1]}
            twin = "2df3187b-4b91-4de9-9b26-d48a30700cec"
            payoff = {"3c939ea6-68b7-4965-b1d3-af1d3dc79778", "83cf4235-eb4e-4c55-839a-f2740d41ed5e"}
            if twin in pair and pair & payoff:
                note = ["The hasty token can use its enter trigger to untap the enchanted original if it is a legal target."]
            target = {"card": other[1], "face": other[2], "name": names[other[1]]}
        else:
            target = target.removeprefix("e:")
        edges[fid].append({"kind": kind, "target": target, "note": note[0] if note else ""})

    formats = pack["spec"]["formats"]
    index, search = [], []
    shards = defaultdict(dict)
    for cid, oid, layout, face_ids, legal, restricted, extra, reserved in cards.values():
        details = []
        types = []
        for position, fid in enumerate(face_ids):
            f = faces[fid]
            if f[:3] != [fid, cid, position]:
                raise ValueError(f"Invalid owner or position for face {fid}")
            types.extend(text[k] for k in f[9])
            details.append({
                "name": text[f[3]], "cost": [text[k] for k in f[4]], "faceManaValue": f[5]/2,
                "type": " ".join(text[k] for k in f[8]+f[9]) + (" — " + " ".join(text[k] for k in f[10]) if f[10] else ""),
                "keywords": [text[k] for k in f[11]], "text": [text[k] for k in f[12]],
                "power": text.get(f[13]), "toughness": text.get(f[14]), "loyalty": text.get(f[15]),
                "defense": text.get(f[16]), "edge": edges[fid],
            })
        index.append([cid, names[cid], oid, list(dict.fromkeys(types))])
        search.append([cid, " ".join(word for f in details for word in f["keywords"]+f["text"])])
        shards[cid//128][cid] = {
            "name": names[cid], "oracleId": oid, "layout": text[layout], "faces": details,
            "setCodes": sorted(sets[cid]), "legal": [fmt for i, fmt in enumerate(formats) if legal & (1 << i)],
            "restricted": [fmt for i, fmt in enumerate(formats) if restricted & (1 << i)],
            "extraLegalities": extra,
        }
    save("index", index)
    save("oracle", search)
    for key, group in shards.items():
        save(f"cards-{key}", group)
    save("meta", {"cards": len(cards), "faces": len(faces), "sets": len(pack["prints"]),
                  "snapshot": pack["catalog"]["date"], "sha256": digest})


if __name__ == "__main__":
    build(Path(sys.argv[1]), Path(sys.argv[2]))
