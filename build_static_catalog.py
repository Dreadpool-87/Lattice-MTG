"""Generate script-free catalog pages from the versioned Lattice assets."""
import json
import re
import unicodedata
from collections import defaultdict
from html import escape
from pathlib import Path

PAGE_SIZE = 16
PREFIX_SUBGROUP_LIMIT = 8


def word_key(name):
    ascii_name = unicodedata.normalize("NFKD", name.casefold())
    return re.sub(r"[^a-z0-9]", "", ascii_name) or "other"


def link(path, label):
    page_path, fragment_marker, fragment = path.partition("#")
    # Sites serves HTML at extensionless URLs, while old .html links redirect.
    href = page_path.removesuffix(".html") + fragment_marker + fragment
    return f'<a href="{escape(href)}">{escape(label)}</a>'


def page(title, body):
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)} · Lattice MTG</title><link rel="stylesheet" href="../styles.css"></head>
<body><main class="wrap static-catalog">
<p>{link("../", "Lattice MTG")} · {link("./", "Static card lookup")}</p>
<h1>{escape(title)}</h1>
{body}
</main></body></html>
"""


def card_article(card, links):
    faces = []
    for face in card["faces"]:
        traits = []
        if face["power"] is not None:
            traits.append(f'{face["power"]}/{face["toughness"]}')
        for key in ("loyalty", "defense"):
            if face[key] is not None:
                traits.append(f'{key.title()} {face[key]}')
        facts = [face["type"], "".join(face["cost"]) or "No mana cost",
                 *([] if face["faceManaValue"] is None else [f'Catalog face mana value {face["faceManaValue"]:g}']), *traits]
        lines = [f'<h3>{escape(face["name"])}</h3><p>{escape(" · ".join(facts))}</p>']
        if face["keywords"]:
            lines.append(f'<p>Source labels: {escape(", ".join(face["keywords"]))}</p>')
        lines.extend(f"<p>{escape(rule)}</p>" for rule in face["text"])
        for edge in face["edge"]:
            if edge["kind"] == "curated":
                target = edge["target"]["card"]
                lines.append(f'<p>Curated interaction: {link(links[target], edge["target"]["name"])}. {escape(edge["note"])}</p>')
        faces.extend(lines)

    states = card["snapshotLegality"]
    systems = states.get("legalityVariants", [states.get("legality", {})])
    legality = []
    for index, formats in enumerate(systems, 1):
        if len(systems) > 1:
            legality.append(f"<p>Source legality variant {index}:</p>")
        for status, values in formats.items():
            label = status.replace("_", " ").capitalize()
            legality.append(f"<p>{escape(label)}: {escape(', '.join(values))}.</p>")
    if not legality:
        legality.append("<p>No format status reported by this snapshot.</p>")
    mana = card.get("catalogManaValues", [card["catalogManaValue"]] if "catalogManaValue" in card else [])
    card_value = f"<p>Catalog card mana value: {', '.join(map(str, mana))}.</p>" if mana else ""
    return f"""<article id="{escape(card["oracleId"])}">
<h2>{escape(card["name"])}</h2>
<p>Oracle ID: <code>{escape(card["oracleId"])}</code> · Layout: {escape(card["layout"])}</p>
{card_value}
{"".join(faces)}
<p>Sets: {escape(", ".join(card["setCodes"]) or "none recorded")}</p>
{"".join(legality)}
<p class="hint">Formats absent from the source status lists are unreported.</p>
</article>
"""


def render_letter(entries, split_names):
    groups = defaultdict(list)
    for prefix, filename, first, last, count in entries:
        groups[prefix[:2]].append((prefix, filename, first, last, count))

    jumps = " ".join(link(f"#prefix-{prefix}", prefix.upper()) for prefix in groups)
    parts = [f'<nav aria-label="Name prefixes" class="alphabet">{jumps}</nav>',
             '<p>Choose a prefix, then open a card range. Check the exact card name in the range.</p>']
    for name, paths in sorted(split_names.items()):
        range_links = " and ".join(link(path, label) for path, label in paths)
        parts.append(f"<p><strong>{escape(name)}</strong> appears in multiple ranges. "
                     f"Open all matching ranges: {range_links}.</p>")

    def render_ranges(ranges, show_prefix):
        rows = []
        for prefix, filename, first, last, count in ranges:
            label = first if first == last else f"{first} to {last}"
            if show_prefix:
                label = f"{prefix.upper()} — {label}"
            rows.append(f"<li>{link(filename, label)} ({count})</li>")
        return "<ul>" + "".join(rows) + "</ul>"

    for prefix, ranges in groups.items():
        parts.append(f'<section aria-labelledby="prefix-{prefix}">')
        parts.append(f'<h2 id="prefix-{prefix}">{prefix.upper()}</h2>')
        subgroups = defaultdict(list)
        for entry in ranges:
            subgroups[entry[0]].append(entry)
        if len(ranges) > PREFIX_SUBGROUP_LIMIT and len(subgroups) > 1:
            for subprefix, entries_for_prefix in subgroups.items():
                if subprefix != prefix:
                    parts.append(f"<h3>{subprefix.upper()}</h3>")
                parts.append(render_ranges(entries_for_prefix, False))
        else:
            parts.append(render_ranges(ranges, True))
        parts.append("</section>")
    return "\n".join(parts)


def build_home(root, meta):
    fields = {
        **{name: f"{meta[name]:,}" for name in ("cards", "faces", "sets")},
        "snapshot": escape(meta["snapshot"]),
    }
    template = (root.parent/"index.template.html").read_text(encoding="utf-8")
    output = re.sub(r"\{\{(\w+)\}\}", lambda match: fields[match[1]], template)
    (root/"index.html").write_text(output, encoding="utf-8")


def build(root):
    output = root / "cards"
    output.mkdir(exist_ok=True)
    data = root / "data"
    rows = json.loads((data / "index.json").read_text(encoding="utf-8"))
    meta = json.loads((data / "meta.json").read_text(encoding="utf-8"))
    buckets = {}
    for path in sorted(data.glob("cards-*.json")):
        buckets.update(json.loads(path.read_text(encoding="utf-8")))

    partitions = defaultdict(list)
    for cid, name, oid, _ in rows:
        key = word_key(name)
        partitions[key[:3]].append((key, cid, name, oid))
    pages = {}
    links = {}
    letters = defaultdict(list)
    name_ranges = defaultdict(dict)
    for prefix, items in sorted(partitions.items()):
        items.sort()
        for offset in range(0, len(items), PAGE_SIZE):
            batch = items[offset:offset+PAGE_SIZE]
            suffix = f"-{offset//PAGE_SIZE+1}" if offset else ""
            filename = f"p-{prefix}{suffix}.html"
            pages[filename] = batch
            first, last = batch[0][2], batch[-1][2]
            letters[prefix[0]].append((prefix, filename, first, last, len(batch)))
            label = first if first == last else f"{first} to {last}"
            for _, cid, name, oid in batch:
                links[cid] = f"{filename}#{oid}"
                name_ranges[name][filename] = label

    for filename, batch in pages.items():
        first, last = batch[0][2], batch[-1][2]
        title = first if first == last else f"{first} to {last}"
        sections = [card_article(buckets[str(cid)], links) for _, cid, _, _ in batch]
        (output / filename).write_text(page(title, "".join(sections)), encoding="utf-8")
    split_names = defaultdict(dict)
    for name, paths in name_ranges.items():
        if len(paths) > 1:
            split_names[word_key(name)[0]][name] = list(paths.items())
    for letter, entries in letters.items():
        (output/f"letter-{letter}.html").write_text(
            page(f"Card names starting with {letter.upper()}", render_letter(entries, split_names[letter])),
            encoding="utf-8",
        )
    alphabet = " ".join(link(f"letter-{letter}.html", letter.upper()) for letter in sorted(letters))
    overview = f"""<p><a href="../lookup/">Compact JSON lookup</a> is the recommended route for agents looking up a card by name.</p>
<p>{meta["cards"]:,} card records from the {escape(meta["snapshot"])} snapshot. Every linked card page contains the card text in its HTML response.</p>
<a href="../sets/" class="start-option catalog-set-link">
  <span><strong>Browse by set</strong><small>Explore expansions and see the cards in each set.</small></span>
  <span aria-hidden="true">→</span>
</a>
<h2>Browse by first letter</h2>
<nav aria-label="Card name index" class="alphabet">{alphabet}</nav>
<p>Follow the letter, prefix, and card range. A prefix link jumps to a section on the letter page. Check the exact card name and open every range listed for a shared name.</p>
<p>For bulk or exact-ID lookup, <a href="../data/index.json">download the card index</a>. Each row contains the internal ID, name, Oracle ID, and card types. Divide the internal ID by 128 and round down to find the number in <code>data/cards-N.json</code>, then read that ID's record.</p>
<p>Format statuses are from this snapshot, including explicit bans. Formats absent from the source are unreported.</p>"""
    (output/"index.html").write_text(page("Static card lookup", overview), encoding="utf-8")
    build_home(root, meta)
    print(f"Published {len(links):,} card records across {len(pages):,} static HTML pages")


if __name__ == "__main__":
    build(Path(__file__).resolve().parent/"dist")
