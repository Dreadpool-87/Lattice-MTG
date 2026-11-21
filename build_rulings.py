"""Publish official Scryfall rulings as small JSON files keyed by Oracle ID."""
from collections import defaultdict
from datetime import date
import gzip
from itertools import product
import json
from pathlib import Path
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


def publish(output, metadata, compressed):
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

    buckets = defaultdict(dict)
    count = 0
    for oracle_id, notes in sorted(rulings.items()):
        buckets[oracle_id[:2]][oracle_id] = sorted(notes, reverse=True)
        count += len(notes)
    output.mkdir(parents=True, exist_ok=True)
    for first, second in product("0123456789abcdef", repeat=2):
        prefix = first + second
        (output / f"{prefix}.json").write_text(
            json.dumps(buckets[prefix], ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
    (output / "meta.json").write_text(
        json.dumps({"snapshot": snapshot, "source": BULK_URL, "rulings": count, "cards": len(rulings)}),
        encoding="utf-8",
    )
    print(f"Published {count:,} official rulings for {len(rulings):,} Oracle IDs from {snapshot}")


if __name__ == "__main__":
    metadata = json.loads(fetch(BULK_URL, "application/json"))
    download_url = metadata["jsonl_download_uri"]
    if not EXPORT_URL.fullmatch(download_url):
        raise ValueError("Unexpected Scryfall rulings download URL")
    publish(Path("dist/data/rulings"), metadata, fetch(download_url, "application/gzip,*/*;q=0.8"))
