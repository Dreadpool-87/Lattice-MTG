"""Build small, deterministic lookup files from the pinned AtomicCards source."""
import argparse
import gzip
import hashlib
import json
import lzma
import re
import unicodedata
from collections import defaultdict
from html import escape
from pathlib import Path

SOURCE_HASH = "63a7fe12b7216be04a15b3afc56662a3ea58b886579bb6d378970d43174c68b7"
SOURCE = "https://github.com/Dreadpool-87/MTGJSON-slim/releases/tag/atomic-slim-2026-11-17-4a1d69647317fbf5"
LIMIT = 8
ENTRY_RULE = (
    "Apply Unicode NFKD, lowercase, and keep a-z and 0-9. Use other if the key is empty. "
    "Fetch the first four characters (or fewer) plus .json. Follow routes[fullKey] if returned. "
    "In every cards response, compare the full card name and return all exact matches. "
    "No matching route key or record in a successful response means no exact match in this snapshot. "
    "An access failure leaves the result unverified."
)


def key(name):
    folded = unicodedata.normalize("NFKD", name.lower())
    return re.sub(r"[^a-z0-9]", "", folded) or "other"


def legalities(rows):
    variants = set()
    for row in rows:
        groups = defaultdict(list)
        for fmt, status in sorted(row.get("legalities", {}).items()):
            groups[status.lower().replace(" ", "_")].append(fmt)
        variants.add(tuple(sorted((status, tuple(values)) for status, values in groups.items())))
    result = [dict(variant) for variant in sorted(variants)]
    return {"legality": result[0]} if len(result)==1 else {"legalityVariants": result}


def card_mana_value(rows):
    values = sorted({r["manaValue"] for r in rows if r.get("manaValue") is not None})
    if not values:
        return {}
    if len(values) == 1:
        return {"catalogManaValue":values[0]}
    return {"catalogManaValues":values}


def compact(card, source):
    faces = []
    for face in card["faces"]:
        cost = "".join(face["cost"])
        matches = [r for r in source if (r.get("faceName") or r["name"]) == face["name"]
                   and (r.get("manaCost") or "") == cost]
        values = {r.get("faceManaValue", r.get("manaValue")) for r in matches}
        if face["faceManaValue"] not in values:
            raise ValueError(f'Cannot verify {card["oracleId"]} face {face["name"]}')
        texts = {r.get("text") or "" for r in matches}
        if len(texts)!=1:
            raise ValueError(f'Ambiguous source text for {card["oracleId"]} face {face["name"]}')
        text = texts.pop()
        result = {"name":face["name"], "type":face["type"], "catalogFaceManaValue":face["faceManaValue"]}
        if cost:
            result["manaCost"] = cost
        if text:
            result["oracleText"] = text
        for stat in ("power", "toughness", "loyalty", "defense"):
            if face[stat] is not None:
                result[stat] = face[stat]
        faces.append(result)
    return {"name":card["name"], "oracleId":card["oracleId"], "layout":card["layout"],
            "faces":faces, **card_mana_value(source), **legalities(source)}


def document(title, body, css):
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)} · Lattice MTG</title><link rel="stylesheet" href="{css}"></head>
<body><main class="wrap static-catalog"><h1>{escape(title)}</h1>{body}</main></body></html>
"""


def build_card_part_index(output):
    manifest = json.loads((output/"manifest.json").read_bytes())
    groups = defaultdict(lambda: defaultdict(lambda: defaultdict(set)))
    seen = set()
    spell_labels = {"prepare": "Prepare spell", "adventure": "Adventure", "omen": "Omen"}
    for filename in manifest["files"]:
        payload = json.loads((output/filename).read_bytes())
        for card in payload.get("cards", []):
            name, oracle_id = card["name"], card["oracleId"]
            if oracle_id in seen:
                raise ValueError(f"Duplicate lookup record for {oracle_id}")
            seen.add(oracle_id)
            for position, face in enumerate(card["faces"]):
                part = face["name"]
                if not part or part == name:
                    continue
                slug = key(part)
                label = spell_labels.get(card["layout"], "Card face") if position else "Card face"
                groups[slug[:2]][slug][part].add((name, oracle_id, filename, label))

    if len(seen) != manifest["oracleIds"]:
        raise ValueError("Card-part index did not read the full lookup catalog")

    index = output/"parts"
    index.mkdir(exist_ok=True)
    links = []
    for prefix, slugs in sorted(groups.items()):
        links.append(f'<a href="{prefix}.html">{prefix.upper()}</a>')
        sections = []
        for slug, parts in sorted(slugs.items()):
            matches = []
            for part, records in sorted(parts.items()):
                entries = "".join(
                    f'<li><a href="../{file}">{escape(name)}</a> · {label} · <code>{escape(oid)}</code></li>'
                    for name, oid, file, label in sorted(records, key=lambda row: (row[0].casefold(), row[1]))
                )
                matches.append(f'<h2>{escape(part)}</h2><ul>{entries}</ul>')
            sections.append(f'<section id="{slug}">{"".join(matches)}</section>')
        body = '<p><a href="./">All card-part prefixes</a> · <a href="../">Compact lookup</a></p>'
        (index/f"{prefix}.html").write_text(
            document(f"Card parts · {prefix.upper()}", body + "\n".join(sections), "../../styles.css"),
            encoding="utf-8",
        )

    body = (
        '<p><a href="../">Compact lookup</a></p>'
        '<p>Find a named card face, Prepare spell, Adventure, or other named card part. '
        'Normalize the part name the same way as a full card name and follow its first two characters '
        '(or one for a one-character name). Each match links to the full card record. '
        'Use the Oracle ID shown to select the record in the JSON file. '
        'A Prepare spell shares the Oracle ID of the card that can prepare it.</p>'
    )
    if "Seed Suture" in groups.get("se", {}).get("seedsuture", {}):
        body += '<p>Example: <a href="se.html#seedsuture">Seed Suture</a>.</p>'
    navigation = '<nav class="alphabet" aria-label="Card-part prefixes">' + "\n".join(links) + "</nav>"
    (index/"index.html").write_text(
        document("Browse by card part", body + navigation, "../../styles.css"),
        encoding="utf-8",
    )
    for page in index.glob("*.html"):
        if re.fullmatch(r"[a-z0-9]{1,2}", page.stem) and page.stem not in groups:
            page.unlink()


def build_guides(output, files, buckets, date):
    integrity = output/"integrity"
    browse = output/"browse"
    integrity.mkdir(exist_ok=True)
    browse.mkdir(exist_ok=True)
    ranges = defaultdict(dict)
    for filename, fields in files.items():
        prefix = filename.split(".", 1)[0].split("-", 1)[0]
        ranges[prefix[:2]][filename] = fields
    links = "".join(f'<li><a href="{prefix}.html">{prefix}</a></li>' for prefix in ranges)
    for section, title in ((browse, "Lookup files by prefix"), (integrity, "Checksums by prefix")):
        (section/"index.html").write_text(document(title,
            '<p>Choose the first two characters of the normalized name. Use one character for a one-character key.</p>'
            f'<p><a href="../">Compact lookup</a></p><ul>{links}</ul>', "../../styles.css"), encoding="utf-8")
    for prefix, subset in ranges.items():
        links = "".join(f'<li><a href="../{file}">{file}</a></li>' for file in subset)
        (browse/f"{prefix}.html").write_text(document(f"Lookup files · {prefix}",
            f'<p><a href="./">All prefixes</a> · <a href="../integrity/{prefix}.html">Checksums</a></p><ul>{links}</ul>',
            "../../styles.css"), encoding="utf-8")
        hashes = {"snapshot":date, "algorithm":"sha256", "files":subset}
        (integrity/f"{prefix}.json").write_text(json.dumps(hashes,separators=(",", ":"))+"\n", encoding="utf-8")
        entries = "".join(f'<li><a href="../{file}">{file}</a> · {x["bytes"]:,} bytes · <code>{x["sha256"]}</code></li>'
                          for file, x in subset.items())
        (integrity/f"{prefix}.html").write_text(document(f"Checksums · {prefix}",
            f'<p>Snapshot {date} · <a href="{prefix}.json">Download the JSON manifest</a></p><ul>{entries}</ul>',
            "../../styles.css"), encoding="utf-8")

    samples = []
    for name in ("Fast // Furious", "Lightning Bolt", "Blood Crypt", "Delver of Secrets // Insectile Aberration", "Splinter Twin"):
        slug = key(name)
        for card in buckets[slug[:4]][slug]:
            oid = escape(card["oracleId"])
            sample = escape(json.dumps(card, ensure_ascii=False, indent=2))
            samples.append(f'<article id="{oid}"><h2>{escape(name)}</h2><pre>{sample}</pre></article>')
    (output/"examples.html").write_text(document("Card lookup examples",
        '<p>These sample records are embedded in HTML and require no JavaScript. '
        '<a href="./">Compact lookup</a> · <a href="../cards/">Full text catalog</a></p>'+"".join(samples),
        "../styles.css"), encoding="utf-8")


def build(path, dist):
    with path.open("rb") as stream:
        sha256 = hashlib.file_digest(stream, "sha256").hexdigest()
    if sha256 != SOURCE_HASH:
        raise ValueError("Unexpected AtomicCards source archive")
    with lzma.open(path, "rt", encoding="utf-8") as stream:
        snapshot = json.load(stream)
    source = defaultdict(list)
    for rows in snapshot["data"].values():
        for row in rows:
            source[row["identifiers"]["scryfallOracleId"]].append(row)
    buckets = defaultdict(lambda:defaultdict(list))
    seen = set()
    for path in sorted((dist/"data").glob("cards-*.json")):
        raw = path.read_bytes()
        shard = json.loads(raw)
        for card in shard.values():
            oid = card["oracleId"]
            if oid in seen:
                raise ValueError(f"Duplicate Oracle ID: {oid}")
            seen.add(oid)
            slug = key(card["name"])
            rows = source[oid]
            buckets[slug[:4]][slug].append(compact(card, rows))
            card["snapshotLegality"] = legalities(rows)
            card.update(card_mana_value(rows))
        encoded = json.dumps(shard, ensure_ascii=False, separators=(",", ":")).encode()
        if encoded != raw:
            path.write_bytes(encoded)
    if seen != source.keys():
        raise ValueError("Site Oracle IDs differ from the source")

    publish_lookup(dist, buckets, len(seen), snapshot["meta"]["date"],
                   snapshot["meta"]["version"], SOURCE, sha256)


def publish_lookup(dist, buckets, count, snapshot, version, source_url, sha256):
    output = dist/"lookup"
    output.mkdir(exist_ok=True)
    checksums = {}

    def write(filename, value, track=True):
        data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode() + b"\n"
        (output/filename).write_bytes(data)
        if track:
            checksums[filename] = {"sha256":hashlib.sha256(data).hexdigest(), "bytes":len(data)}

    def write_cards(filename, cards):
        names = defaultdict(list)
        for card in cards:
            names[card["name"]].append(card["oracleId"])
        ambiguities = {name: ids for name, ids in names.items() if len(ids)>1}
        value = {"cards":cards}
        if ambiguities:
            value["ambiguousNames"] = ambiguities
        write(filename, value)

    for prefix, groups in sorted(buckets.items()):
        filename = prefix+".json"
        records = [record for group in groups.values() for record in group]
        if len(records)<=LIMIT:
            write_cards(filename, records)
            continue
        routes, batch = {}, []
        part = 1
        for slug, group in sorted(groups.items()):
            if len(group)>LIMIT:
                raise ValueError(f"Too many variants for {slug}")
            if len(batch)+len(group)>LIMIT:
                write_cards(f"{prefix}-{part}.json", batch)
                batch = []
                part += 1
            routes[slug] = f"{prefix}-{part}.json"
            batch.extend(group)
        if batch:
            write_cards(f"{prefix}-{part}.json", batch)
        write(filename, {"routes":routes})

    bolt_key = key("Lightning Bolt")
    bolt_prefix = bolt_key[:4]+".json"
    entry = json.loads((output/bolt_prefix).read_bytes())
    bolt_file = entry.get("routes", {}).get(bolt_key, bolt_prefix)
    write("manifest.json", {
        "schema":"lattice-compact-lookup-v1", "snapshot":snapshot,
        "sourceVersion":version, "source":source_url, "sourceArchiveSha256":sha256,
        "oracleIds":count, "maxRecordsPerResponse":LIMIT,
        "entryRule":ENTRY_RULE,
        "example":{"card":"Lightning Bolt", "entry":bolt_prefix, "data":bolt_file},
        "integrityIndex":"integrity/",
        "files":checksums,
    }, track=False)
    collection = dist/"collection"
    collection.mkdir(exist_ok=True)
    catalog = {
        "snapshot": snapshot,
        "source": source_url,
        "cards": [record for _, groups in sorted(buckets.items())
                  for _, records in sorted(groups.items()) for record in records],
    }
    # Deterministic gzip asset. The browser loads it once for the whole import.
    target = collection/"catalog.json.gz"
    with target.open("wb") as raw, gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as stream:
        stream.write(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")).encode())

    date = escape(snapshot)
    build_guides(output, checksums, buckets, date)
    write_lookup_index(output, count, snapshot, source_url, bolt_prefix, bolt_file)
    print(f"{count:,} verified Oracle IDs; {len(checksums):,} lookup JSON files; Bolt: {bolt_file}")


def write_lookup_index(output, count, snapshot, source_url, bolt_prefix, bolt_file):
    date = escape(snapshot)
    (output/"index.html").write_text(f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Compact card lookup · Lattice MTG</title><link rel="stylesheet" href="../styles.css"></head>
<body><main class="wrap static-catalog"><p><a href="../">Lattice MTG</a> · <a href="../cards/">Alphabetical catalog</a></p>
<h1>Compact card lookup</h1>
<p>{count:,} Oracle IDs from the {date} snapshot. Plain JSON, with at most {LIMIT} card records per data response.</p>
<p id="site-data-snapshots"></p>
<p><a href="parts/">Browse by card part</a> if you know the name of a Prepare spell, Adventure, or card face.</p>
<ol>
<li>Take the full card name. Apply Unicode NFKD, lowercase, and keep only a–z and 0–9. Lightning Bolt becomes <code>lightningbolt</code>. If nothing remains, use <code>other</code> as the full key.</li>
<li>Fetch its first four characters, or the entire key if shorter, followed by <code>.json</code>. For Lightning Bolt, open <a href="{bolt_prefix}"><code>{bolt_prefix}</code></a>.</li>
<li>If the response contains <code>routes</code>, use the full key to find the file. For Lightning Bolt, open <a href="{bolt_file}"><code>{bolt_file}</code></a>. If the first file contains <code>cards</code>, use it directly.</li>
<li>In every <code>cards</code> response, compare the full card name and keep only exact name matches. Normalization selects a file, and several different names can share that file or key. Check <code>ambiguousNames</code>. When several Oracle IDs match, return them all or ask for the Oracle ID.</li>
</ol>
<ul>
<li><strong>No exact match:</strong> A successfully retrieved JSON file has no matching route key or no matching full card name. If the first JSON file could not be retrieved, check the <a href="browse/">linked file index</a>. If the index loads and omits that prefix or file, the snapshot has no match.</li>
<li><strong>Unverified:</strong> A listed file, a routed file, or the index page needed to check a missing prefix could not be read. A failed request or a 404 alone does not establish absence.</li>
<li><strong>Tokens and emblems:</strong> Search for these in the <a href="../">Card Explorer</a> or use the <a href="../data/tokens.json.gz">compressed token catalog</a>. They are outside the scope of this compact lookup. For example, the exact name Treasure can match a non-token record here.</li>
</ul>
<p>Each face includes the source Oracle text. A format missing from the status lists is unreported. Snapshot statuses do not capture all printing-level or commander-specific restrictions. <code>catalogManaValue</code> describes the card in the source. <code>catalogFaceManaValue</code> describes the face in the source. Game rules determine the value in a particular zone or state.</p>
<p><a href="browse/">Browse linked JSON files</a> · <a href="examples.html">HTML examples</a></p>
<p><a href="integrity/">Small checksum manifests</a> · <a href="manifest.json">Full SHA-256 manifest</a> · <a href="{escape(source_url)}">Card data source</a></p>
</main></body></html>
""", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("dist", type=Path)
    args = parser.parse_args()
    build(args.source, args.dist)
