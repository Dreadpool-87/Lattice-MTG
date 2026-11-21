"""Publish official Scryfall rulings as small JSON files keyed by Oracle ID."""
from collections import defaultdict
from datetime import date
import gzip
from itertools import product
import json
import re
from urllib.request import Request, urlopen

BULK_URL = "https://api.scryfall.com/bulk-data/rulings"
USER_AGENT = "Lattice-MTG/1.0 (https://github.com/Dreadpool-87/Lattice-MTG)"
ORACLE_ID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")
EXPORT_URL = re.compile(r"https://data\.scryfall\.io/rulings/rulings-\d+\.jsonl\.gz")


def fetch(url, accept):
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    with urlopen(request, timeout=40) as response:
        return response.read()


def collect(metadata, compressed):
    if metadata["type"] != "rulings" or len(compressed) != metadata["compressed_size"]:
        raise ValueError("Unexpected Scryfall rulings export")
    snapshot = date.fromisoformat(metadata["updated_at"][:10]).isoformat()
    rulings = defaultdict(set)
    for line in gzip.decompress(compressed).splitlines():
        record = json.loads(line)
        if record["source"] != "wotc":
            continue
        oracle_id = record["oracle_id"]
        comment = record["comment"].strip()
        if not ORACLE_ID.fullmatch(oracle_id):
            raise ValueError("Invalid Oracle ID in Scryfall rulings export")
        if not comment:
            continue
        rulings[oracle_id].add((date.fromisoformat(record["published_at"]).isoformat(), comment))
    if not rulings:
        raise ValueError("No official rulings in Scryfall export")

    notes = {
        oracle_id: [list(note) for note in sorted(entries, reverse=True)]
        for oracle_id, entries in sorted(rulings.items())
    }
    return {
        "snapshot": snapshot, "source": BULK_URL,
        "rulings": sum(map(len, notes.values())), "cards": len(notes), "notes": notes,
    }


def publish(output, cached):
    buckets = defaultdict(dict)
    for oracle_id, notes in cached["notes"].items():
        buckets[oracle_id[:2]][oracle_id] = notes
    output.mkdir(parents=True, exist_ok=True)
    for first, second in product("0123456789abcdef", repeat=2):
        prefix = first + second
        (output / f"{prefix}.json").write_text(
            json.dumps(buckets[prefix], ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
    meta = {key: value for key, value in cached.items() if key != "notes"}
    (output / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    print(f"Published {meta['rulings']:,} official rulings for {meta['cards']:,} Oracle IDs from {meta['snapshot']}")


def download():
    metadata = json.loads(fetch(BULK_URL, "application/json"))
    download_url = metadata["jsonl_download_uri"]
    if not EXPORT_URL.fullmatch(download_url):
        raise ValueError("Unexpected Scryfall rulings download URL")
    return collect(metadata, fetch(download_url, "application/gzip,*/*;q=0.8"))
