"""Record changes to the public data between a Git revision and the staged refresh."""
import argparse
from datetime import datetime, timezone
import gzip
import json
import lzma
from pathlib import Path
import re
import subprocess

from build_sets import page

OUTPUT = Path("dist/updates")
SITE_DATA = "snapshots/site-data.json.xz"
PRINTING_META = "dist/data/printings/meta.json"
ORACLE_SHARD = re.compile(r"dist/data/cards-\d+\.json")
PRINTING_SHARD = re.compile(r"dist/data/printings/set-[a-z0-9]+\.json\.gz")
LABELS = {"oracle": "Oracle cards", "printings": "Printings", "sets": "Sets", "rulings": "Rulings"}


def git(*args):
    return subprocess.check_output(("git", *args))


def staged_changes(before):
    fields = git(
        "diff", "--cached", "--name-status", "--no-renames", "-z", before,
        "--", "dist/data", SITE_DATA,
    ).decode().split("\0")[:-1]
    return dict(zip(fields[1::2], fields[::2]))


def compare(before, after):
    return {
        "added": len(after.keys() - before.keys()),
        "changed": sum(before[key] != after[key] for key in before.keys() & after.keys()),
        "removed": len(before.keys() - after.keys()),
    }


def oracle_records(data):
    records = {}
    for card in json.loads(data).values():
        card.pop("setCodes", None)
        for face in card["faces"]:
            face.pop("edge", None)
        records[card["oracleId"]] = card
    return records


def printing_records(data):
    return {(row[0], row[1]): row for row in json.loads(gzip.decompress(data))}


def compare_shards(before, paths, pattern, load):
    old_changes = {}
    new_changes = {}
    for path, status in paths.items():
        if not pattern.fullmatch(path):
            continue
        old = {} if status == "A" else load(git("show", f"{before}:{path}"))
        new = {} if status == "D" else load(git("show", f":{path}"))
        old_changes.update((key, value) for key, value in old.items() if new.get(key) != value)
        new_changes.update((key, value) for key, value in new.items() if old.get(key) != value)
    return compare(old_changes, new_changes)


def set_records(metadata, site_data):
    dates = site_data["sets"]["releaseDates"]
    return {
        code: (metadata["setNames"][code], dates.get(code.lower()))
        for code in metadata["setShards"]
    }


def ruling_records(site_data):
    return {
        (oracle_id, date, text)
        for oracle_id, notes in site_data["rulings"]["notes"].items()
        for date, text in notes
    }


def changes_since(before):
    paths = staged_changes(before)
    old_meta = json.loads(git("show", f"{before}:{PRINTING_META}"))
    new_meta = json.loads(git("show", f":{PRINTING_META}"))
    old_site = json.loads(lzma.decompress(git("show", f"{before}:{SITE_DATA}")))
    new_site = json.loads(lzma.decompress(git("show", f":{SITE_DATA}")))
    old_rulings = ruling_records(old_site)
    new_rulings = ruling_records(new_site)
    return {
        "oracle": compare_shards(before, paths, ORACLE_SHARD, oracle_records),
        "printings": compare_shards(before, paths, PRINTING_SHARD, printing_records),
        "sets": compare(set_records(old_meta, old_site), set_records(new_meta, new_site)),
        "rulings": {
            "added": len(new_rulings - old_rulings),
            "changed": None,
            "removed": len(old_rulings - new_rulings),
        },
    }


def render_entry(entry):
    timestamp = datetime.fromisoformat(entry["recordedAt"])
    date = timestamp.strftime("%d %b %Y · %H:%M UTC")
    rows = []
    for key, label in LABELS.items():
        counts = entry["changes"][key]
        cells = "".join(
            f"<td>{counts[field]:,}</td>" if counts[field] is not None else "<td>—</td>"
            for field in ("added", "changed", "removed")
        )
        rows.append(f'<tr><th scope="row">{label}</th>{cells}</tr>')
    return (
        f'<article><h2><time datetime="{timestamp.isoformat()}">{date}</time></h2>'
        f'<table class="update-counts" aria-label="Data changes on {date}">'
        '<thead><tr><th scope="col">Dataset</th><th scope="col">Added</th>'
        '<th scope="col">Changed</th><th scope="col">Removed</th></tr></thead>'
        f'<tbody>{"".join(rows)}</tbody></table></article>'
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", default="HEAD")
    parser.add_argument("--timestamp", type=datetime.fromisoformat)
    args = parser.parse_args()
    changes = changes_since(args.before)
    if not any(count for dataset in changes.values() for count in dataset.values()):
        print("No changes in the tracked public data.")
        return

    timestamp = (args.timestamp or datetime.now(timezone.utc)).astimezone(timezone.utc)
    history_path = OUTPUT / "history.json"
    history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else []
    history.insert(0, {"recordedAt": timestamp.isoformat(timespec="seconds"), "changes": changes})
    OUTPUT.mkdir(exist_ok=True)
    history_path.write_text(json.dumps(history, indent=2) + "\n", encoding="utf-8")
    content = (
        '<p>Changes in each published Scryfall refresh. Only refreshes with changes to the '
        'datasets below are listed.</p><p><a href="history.json">History JSON</a></p>'
        + "".join(map(render_entry, history))
        + '<p>Oracle changes cover card records and format legality. Set changes cover names '
        'and release dates. Rulings are compared by card, date and text, so a rewritten ruling '
        'counts as one removal and one addition.</p>'
        '<footer><a href="https://lattice-mtg-admin.dreadpool.workers.dev/" referrerpolicy="no-referrer">Admin</a></footer>'
    )
    (OUTPUT / "index.html").write_text(
        page("Data updates", "../styles.css", '<p><a href="../">Lattice MTG</a></p>', content),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
