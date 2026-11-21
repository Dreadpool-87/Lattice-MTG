"""Build the browser's printing indexes from an AllPrintings Slim SQLite release."""
import argparse
from collections import defaultdict
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
from uuid import UUID


def write_gzip(path, value):
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    path.write_bytes(gzip.compress(data, mtime=0))


def write_printing_routes(output, prints_by_set):
    """Index the edition containing each printing ID for imports without set codes."""
    routes = defaultdict(dict)
    for code, rows in sorted(prints_by_set.items()):
        for printing_id in {row[0] for row in rows}:
            bucket = routes[printing_id[0]]
            if bucket.setdefault(printing_id, code) != code:
                raise ValueError(f"Printing ID belongs to multiple sets: {printing_id}")
    for prefix, bucket in sorted(routes.items()):
        write_gzip(output / f"id-set-{prefix}.json.gz", sorted(bucket.items()))
    return sorted(routes)


def build(database, output, source):
    output.mkdir(parents=True, exist_ok=True)
    by_oracle = defaultdict(set)
    rows = set()
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as db:
        snapshot, version = db.execute("SELECT date, version FROM meta").fetchone()
        set_names = dict(db.execute("SELECT code, name FROM sets"))
        for token, table, identifiers, printed_name in (
            (0, "cards", "cardIdentifiers", "COALESCE(c.printedName, c.facePrintedName, c.flavorName, c.name)"),
            (1, "tokens", "tokenIdentifiers", "COALESCE(c.flavorName, c.name)"),
        ):
            query = f"""
                SELECT i.scryfallId, i.scryfallOracleId, c.setCode, c.number,
                       c.language, {printed_name}, c.finishes
                FROM {table} c JOIN {identifiers} i USING (uuid)
            """
            for printing_id, oracle_id, code, number, language, name, finishes in db.execute(query):
                if not printing_id or not oracle_id:
                    continue
                printing_id, oracle_id = str(UUID(printing_id)), str(UUID(oracle_id))
                row = (printing_id, oracle_id, code, number, language or "", name or "", finishes or "", token)
                rows.add(row)
                if not token:
                    by_oracle[oracle_id[:2]].add(row)

    for prefix, records in sorted(by_oracle.items()):
        write_gzip(output / f"oracle-{prefix}.json.gz", sorted(records))
    write_gzip(output / "all.json.gz", sorted(rows))
    with database.open("rb") as file:
        database_sha256 = hashlib.file_digest(file, "sha256").hexdigest()
    metadata = {"snapshot": snapshot, "version": version, "source": source, "sha256": database_sha256,
                "count": len(rows), "setNames": set_names}
    (output / "meta.json").write_text(json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
                                       encoding="utf-8")
    print(f"{len(rows):,} printing variants, {len(by_oracle)} Oracle shards")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--source", required=True, help="Source release URL to record in the index")
    args = parser.parse_args()
    build(args.database, args.output, args.source)
