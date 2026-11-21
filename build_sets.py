"""Build a static set index from the existing printing snapshot."""
from collections import defaultdict
from html import escape
import gzip
import json
from pathlib import Path
import re

from build_rulings import fetch

SETS_URL = "https://api.scryfall.com/sets"
SET_CODE = re.compile(r"[a-z0-9]+")
ARTICLE_ID = re.compile(r'<article id="([0-9a-f-]+)">')
NUMBER_PARTS = re.compile(r"(\d+)")


def page(title, stylesheet, navigation, content):
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)} · Lattice MTG</title><link rel="stylesheet" href="{stylesheet}"></head>
<body><main class="wrap static-catalog">
{navigation}
<h1>{escape(title)}</h1>
{content}
</main></body></html>
"""


def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def card_list(path, names, catalog):
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        printings = json.load(stream)
    representatives = {}
    for printing_id, oracle_id, _, number, lang, printed_name, *_ in printings:
        key = (number, oracle_id)
        current = representatives.get(key)
        if current is None or (lang == "en" and current[0] != "en"):
            representatives[key] = (lang, printed_name, printing_id)

    cards = []
    for (number, oracle_id), (_, printed_name, printing_id) in representatives.items():
        if oracle_id in catalog:
            url = f"../../cards/{catalog[oracle_id]}#{oracle_id}"
        elif oracle_id in names:
            url = f"../../?card={oracle_id}"
        else:
            url = f"https://scryfall.com/card/{printing_id}"
        cards.append({
            "number": number, "name": names.get(oracle_id, printed_name),
            "oracleId": oracle_id, "url": url,
        })
    return sorted(cards, key=lambda card: (
        [int(part) if i % 2 else part
         for i, part in enumerate(NUMBER_PARTS.split(card["number"].casefold()))],
        card["name"].casefold(), card["oracleId"],
    ))


def publish(dist, upstream):
    data = dist / "data"
    printings = data / "printings"
    metadata = json.loads((printings / "meta.json").read_text(encoding="utf-8"))
    snapshot = metadata["snapshot"]
    source_sets = {entry["code"]: entry for entry in upstream["data"]}
    names = {row[2]: row[1] for row in json.loads((data / "index.json").read_text(encoding="utf-8"))}
    with gzip.open(data / "tokens.json.gz", "rt", encoding="utf-8") as stream:
        names.update({token["oracleId"]: token["name"] for token in json.load(stream)})
    catalog = {
        oracle_id: path.name for path in sorted((dist / "cards").glob("p-*.html"))
        for oracle_id in ARTICLE_ID.findall(path.read_text(encoding="utf-8"))
    }

    output = dist / "sets"
    output.mkdir(exist_ok=True)
    sets = []
    for code in sorted(metadata["setShards"]):
        slug = code.lower()
        if not SET_CODE.fullmatch(slug):
            raise ValueError(f"Invalid set code: {code}")
        source = source_sets.get(slug, {})
        name = metadata["setNames"][code]
        released = source.get("released_at")
        cards = card_list(printings / f"set-{slug}.json.gz", names, catalog)
        summary = {"code": code, "name": name, "released": released, "entries": len(cards)}
        sets.append({**summary, "url": f"{slug}/", "json": f"{slug}/index.json"})

        folder = output / slug
        folder.mkdir(exist_ok=True)
        save_json(folder / "index.json", {**summary, "snapshot": snapshot, "cards": cards})
        rows = "".join(
            f'<li>{escape(card["number"])} · <a href="{escape(card["url"])}">'
            f'{escape(card["name"])}</a></li>'
            for card in cards
        )
        release = f" · Release date {escape(released)}" if released else ""
        (folder / "index.html").write_text(page(
            f"{name} ({code})", "../../styles.css",
            '<p><a href="../../">Lattice MTG</a> · <a href="../">All sets</a></p>',
            f'<p>{len(cards):,} card entries{release} · Printing snapshot {escape(snapshot)}</p>'
            '<p>Language variants with the same collector number and Oracle ID share one row. '
            '<a href="index.json">Set JSON</a></p>'
            f'<ul>{rows}</ul>',
        ), encoding="utf-8")

    save_json(output / "index.json", {"snapshot": snapshot, "metadataSource": SETS_URL, "sets": sets})
    groups = defaultdict(list)
    for entry in sets:
        groups[entry["code"][0]].append(entry)
    jumps = " ".join(f'<a href="#code-{initial}">{initial}</a>' for initial in groups)
    sections = []
    for initial, entries in groups.items():
        rows = "".join(
            f'<li><a href="{entry["url"]}">{escape(entry["name"])} ({entry["code"]})</a>'
            + (f' · {escape(entry["released"])}' if entry["released"] else "") + "</li>"
            for entry in entries
        )
        sections.append(f'<h2 id="code-{initial}">{initial}</h2><ul>{rows}</ul>')

    (output / "index.html").write_text(page(
        "Browse sets", "../styles.css",
        '<p><a href="../">Lattice MTG</a> · <a href="../cards/">Card catalog</a></p>',
        f'<p>{len(sets):,} sets from the {escape(snapshot)} printing snapshot. '
        '<a href="index.json">Set index JSON</a></p>'
        f'<nav class="alphabet" aria-label="First character of set code">{jumps}</nav>'
        + "\n".join(sections),
    ), encoding="utf-8")
    print(f"Published {len(sets):,} sets from the {snapshot} printing snapshot")


if __name__ == "__main__":
    upstream = json.loads(fetch(SETS_URL, "application/json"))
    if upstream["object"] != "list" or upstream["has_more"] or not upstream["data"]:
        raise ValueError("Expected a complete list of Scryfall sets")
    publish(Path("dist"), upstream)
