"""Refresh the static card snapshot from Scryfall's paired bulk exports."""
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen

from build_rulings import USER_AGENT, fetch
from build_scryfall import DECK_DATA_VERSION, PRINTING_VARIANTS_VERSION, build


BULK_URL = "https://api.scryfall.com/bulk-data"
TYPES = ("oracle_cards", "all_cards")
ROOT = Path(__file__).resolve().parent


def read_json(path):
    return json.loads(path.read_bytes())


def download(entry, path):
    url = entry["jsonl_download_uri"]
    slug = entry["type"].replace("_", "-")
    if not re.fullmatch(rf"https://data\.scryfall\.io/{slug}/{slug}-\d+\.jsonl\.gz", url):
        raise ValueError(f"Unexpected Scryfall {slug} download URL")
    if not 0 < entry["compressed_size"] <= 2_000_000_000:
        raise ValueError(f"Unexpected Scryfall {slug} download size")
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/gzip,*/*;q=0.8"})
    with urlopen(request, timeout=60) as response, path.open("wb") as out:
        shutil.copyfileobj(response, out, length=1024 * 1024)
    if path.stat().st_size != entry["compressed_size"]:
        raise ValueError(f"Incomplete {slug} download")


def content_fingerprint(dist):
    data = dist / "data"
    digest = hashlib.sha256()
    files = sorted([
        *data.glob("cards-*.json"),
        *data.glob("printings/*.json.gz"),
        data / "tokens.json.gz",
        data / "commander-ranks.json.gz",
        *(p for p in (dist / "lookup").glob("*.json") if p.name != "manifest.json"),
    ])
    for path in files:
        opener = gzip.open if path.suffix == ".gz" else Path.open
        with opener(path, "rb") as source:
            digest.update(str(path.relative_to(dist)).encode() + b"\0")
            digest.update(hashlib.file_digest(source, "sha256").digest())
    set_names = read_json(data / "printings" / "meta.json")["setNames"]
    digest.update(json.dumps(set_names, sort_keys=True).encode())
    return digest.digest()


def refresh():
    dist = ROOT / "dist"
    metadata = read_json(dist / "data" / "meta.json")
    printings = read_json(dist / "data" / "printings" / "meta.json")
    listing = json.loads(fetch(BULK_URL, "application/json"))
    entries = {entry["type"]: entry for entry in listing["data"] if entry["type"] in TYPES}
    if listing["object"] != "list" or listing["has_more"] or entries.keys() != set(TYPES):
        raise ValueError("Incomplete Scryfall bulk export listing")

    dates = {datetime.fromisoformat(entry["updated_at"]).astimezone(timezone.utc) for entry in entries.values()}
    if len({stamp.date() for stamp in dates}) != 1 or max(dates) - min(dates) > timedelta(hours=3):
        raise ValueError("Oracle and printing exports are from different refreshes")
    if min(dates) < datetime.now(timezone.utc) - timedelta(days=2):
        raise ValueError("Scryfall card exports are more than two days old")
    if min(dates).date().isoformat() < max(metadata["snapshot"], printings["snapshot"]):
        raise ValueError("Scryfall card exports are older than the pinned snapshot")
    current_schema = (printings.get("variantsVersion") == PRINTING_VARIANTS_VERSION
                      and metadata.get("deckDataVersion") == DECK_DATA_VERSION)
    if (current_schema
            and [entries[name]["jsonl_download_uri"] for name in TYPES] == [metadata["download"], printings["download"]]):
        print("The pinned card and printing exports are already current.")
        return

    with TemporaryDirectory(dir=ROOT) as scratch:
        stage = Path(scratch)
        candidate = stage / "dist"
        (candidate / "data").mkdir(parents=True)
        shutil.copyfile(ROOT / "index.template.html", stage / "index.template.html")
        for path in (dist / "data").glob("cards-*.json"):
            shutil.copyfile(path, candidate / "data" / path.name)
        files = [stage / f"{name}.jsonl.gz" for name in TYPES]
        for name, path in zip(TYPES, files, strict=True):
            download(entries[name], path)

        build(candidate, *files, entries)
        counts = (
            ("cards", read_json(candidate / "data" / "meta.json")["cards"], metadata["cards"]),
            ("printings", read_json(candidate / "data" / "printings" / "meta.json")["count"], printings["count"]),
        )
        for label, current, previous in counts:
            if current == 0 or current * 10 < previous * 9:
                raise ValueError(f"Unexpected {label} count: {previous:,} to {current:,}")
        if current_schema and content_fingerprint(candidate) == content_fingerprint(dist):
            print("Scryfall export versions changed, but the published card data is identical.")
            return

        for folder in ("cards", "lookup", "data/printings"):
            shutil.rmtree(dist / folder)
            shutil.move(candidate / folder, dist / folder)
        for path in (dist / "data").glob("cards-*.json"):
            path.unlink()
        for path in (candidate / "data").iterdir():
            if path.is_file():
                path.replace(dist / "data" / path.name)
        for path in ("index.html", "collection/catalog.json.gz"):
            (candidate / path).replace(dist / path)


if __name__ == "__main__":
    refresh()
