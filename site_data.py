"""Refresh a pinned Scryfall snapshot or build site data offline from that snapshot."""
import argparse
from datetime import date
import json
import lzma
import re
from pathlib import Path
from tempfile import NamedTemporaryFile

import build_lookup
import build_android_catalog
import build_rulings
import build_sets


ROOT = Path(__file__).resolve().parent
SNAPSHOT = ROOT / "snapshots" / "site-data.json.xz"


def validate(snapshot):
    sets, rulings = snapshot["sets"], snapshot["rulings"]
    for dataset in (sets, rulings):
        date.fromisoformat(dataset["snapshot"])
    releases = sets["releaseDates"]
    if not releases or not all(build_sets.SET_CODE.fullmatch(code) for code in releases):
        raise ValueError("Invalid set metadata snapshot")
    for released in releases.values():
        if released is not None:
            date.fromisoformat(released)
    for code, detail in sets.get("setDetails", {}).items():
        if (code not in releases or not build_sets.SET_TYPE.fullmatch(detail["type"])
                or ("parent" in detail and not build_sets.SET_CODE.fullmatch(detail["parent"]))):
            raise ValueError(f"Invalid set details for {code}")

    notes = rulings["notes"]
    if (not notes or len(notes) != rulings["cards"]
            or sum(map(len, notes.values())) != rulings["rulings"]):
        raise ValueError("Incomplete rulings snapshot")
    for oracle_id, entries in notes.items():
        if not build_rulings.ORACLE_ID.fullmatch(oracle_id) or not entries:
            raise ValueError(f"Invalid rulings for {oracle_id}")
        for published, comment in entries:
            date.fromisoformat(published)
            if not isinstance(comment, str) or not comment.strip():
                raise ValueError(f"Invalid ruling text for {oracle_id}")


def load():
    with lzma.open(SNAPSHOT, "rt", encoding="utf-8") as source:
        snapshot = json.load(source)
    validate(snapshot)
    return snapshot


def refresh():
    previous = load() if SNAPSHOT.is_file() else None
    snapshot = {"sets": build_sets.download(), "rulings": build_rulings.download()}
    validate(snapshot)
    if previous:
        for name in ("sets", "rulings"):
            if snapshot[name]["snapshot"] < previous[name]["snapshot"]:
                raise ValueError(f"The {name} snapshot is older than the pinned snapshot")
        counts = (
            (len(snapshot["sets"]["releaseDates"]), len(previous["sets"]["releaseDates"]), "sets"),
            (snapshot["rulings"]["cards"], previous["rulings"]["cards"], "Oracle IDs with rulings"),
            (snapshot["rulings"]["rulings"], previous["rulings"]["rulings"], "rulings"),
        )
        for current, old, label in counts:
            if current * 10 < old * 9:
                raise ValueError(f"Unexpected {label} count: {old:,} → {current:,}")
        if all(snapshot["sets"].get(field) == previous["sets"].get(field) for field in ("releaseDates", "setDetails")):
            snapshot["sets"] = previous["sets"]
        if snapshot["rulings"]["notes"] == previous["rulings"]["notes"]:
            snapshot["rulings"] = previous["rulings"]
        if snapshot == previous:
            print("Set metadata and official rulings have not changed.")
            return

    SNAPSHOT.parent.mkdir(exist_ok=True)
    with NamedTemporaryFile(dir=SNAPSHOT.parent, delete=False) as staged:
        staged_path = Path(staged.name)
    try:
        with lzma.open(staged_path, "wt", encoding="utf-8") as target:
            json.dump(snapshot, target, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        staged_path.replace(SNAPSHOT)
    finally:
        staged_path.unlink(missing_ok=True)
    print(f"Saved sets {snapshot['sets']['snapshot']} and rulings {snapshot['rulings']['snapshot']}")


def build():
    snapshot = load()
    dist = ROOT / "dist"
    build_sets.publish(dist, snapshot["sets"])
    build_rulings.publish(dist / "data" / "rulings", snapshot["rulings"])
    build_lookup.build_card_part_index(dist / "lookup")
    build_android_catalog.publish(dist)

    lookup = dist / "lookup" / "index.html"
    page, count = re.subn(
        r'<p id="site-data-snapshots">[^\n]*</p>',
        '<p id="site-data-snapshots">'
        f'<a href="../sets/">Set metadata</a> snapshot {snapshot["sets"]["snapshot"]} · '
        f'<a href="../data/rulings/meta.json">Official rulings</a> snapshot {snapshot["rulings"]["snapshot"]}.</p>',
        lookup.read_text(encoding="utf-8"),
    )
    if count != 1:
        raise ValueError("Expected one site-data snapshot line on the lookup page")
    lookup.write_text(page, encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("build", "refresh"))
    args = parser.parse_args()
    if args.command == "refresh":
        refresh()
    else:
        build()
