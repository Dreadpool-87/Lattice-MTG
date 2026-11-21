# Lattice MTG

A static Magic: The Gathering card explorer, collection import tool, HTML catalog, and compact JSON lookup.

- `dist/` contains the built site and the committed card and printing snapshots. GitHub Pages builds the set and rulings indexes from the committed Scryfall snapshot in `snapshots/site-data.json.xz`.
- The Python build scripts and HTML template generate the catalog and lookup assets.
- The imported website snapshot is Lattice MTG version 19, source revision `ec746126f3d628e272b4d3f2fd1a162c141cc636`.

## Hosting

[GitHub Pages](https://dreadpool-87.github.io/Lattice-MTG/) · [ChatGPT Sites](https://lattice-mtg-explorer.rustynashi5.chatgpt.site/) · [Scryfall data source](https://scryfall.com/docs/api/bulk-data)

The **Publish Lattice MTG** workflow publishes `dist/` on pushes to `main`. It adapts local links to the GitHub Pages base path and adds explicit `.html` extensions to the catalog links during deployment. The pre-publish check verifies representative card links, lookup records, snapshot data, and CSV import. Publishing uses the committed snapshots and can build without contacting Scryfall. See [Build and rollback](#build-and-rollback).

### Set index

[Browse sets](https://dreadpool-87.github.io/Lattice-MTG/sets/) by set code or name. Each set page links to its card entries and its JSON file. The [JSON set index](https://dreadpool-87.github.io/Lattice-MTG/sets/index.json) links to a JSON file for each set, such as [M19](https://dreadpool-87.github.io/Lattice-MTG/sets/m19/index.json). Resolve relative URLs against the file they appear in.

Set names and card membership come from the committed printing snapshot. Scryfall supplies release dates. A collector number and Oracle ID share one row across languages and finishes. Alternate collector numbers and distinct Oracle IDs are listed separately.

### Official rulings

Lattice uses a pinned Scryfall rulings export and keeps entries attributed to Wizards of the Coast. The rules text and rulings snapshots have separate dates.

For machine lookup, use the first two characters of an Oracle ID as the file name under `data/rulings/`. For example, [`d2.json`](https://dreadpool-87.github.io/Lattice-MTG/data/rulings/d2.json) contains Kenrith, the Returned King under Oracle ID `d209b948-9afb-4fd1-a961-72c87282878c`. Each record is a list of `[date, comment]` pairs. An absent ID in a successfully retrieved file has no official ruling entries in that snapshot. See [`meta.json`](https://dreadpool-87.github.io/Lattice-MTG/data/rulings/meta.json) for the snapshot date and source.

## Build and rollback

Use a clean checkout, Python 3.11+ and Node.js 22+. To reproduce the GitHub Pages build from the committed inputs:

```sh
python3 site_data.py build
python3 prepare_pages.py /Lattice-MTG
node verify_site.mjs /Lattice-MTG
```

The build writes the site to `dist/`. Use an empty base path for both commands that take a path to preview at the server root. Run `python3 -m http.server --directory dist` from that root-base checkout and open `http://localhost:8000/`. Build on a fresh checkout for each base path. The publication-only changes to `dist/` are generated during the Pages run.

- **Refresh set metadata and rulings.** In GitHub Actions, run **Refresh Lattice set metadata and rulings** from `main`, then open the review link in the run summary. Merge the snapshot PR to publish it. Locally, run `python3 site_data.py refresh`, then run the build and checks above and commit only `snapshots/site-data.json.xz`. A failed or incomplete refresh keeps the previous file.
- **Refresh Oracle and printing data.** Use `python3 build_scryfall.py bulk-data.json oracle-cards.jsonl.gz all-cards.jsonl.gz dist` on a clean checkout. Keep the Scryfall bulk metadata and both same-day JSONL gzip files together. The builder checks the archive sizes and records provenance in `dist/data/meta.json` and `dist/data/printings/meta.json`. Commit the resulting card and printing updates before running the Pages build above in a clean checkout.
- **Roll back.** Locate the previous successful **Publish Lattice MTG** run to identify the working revision. Revert the faulty commit or PR through GitHub and merge the revert into `main`. The new Pages run rebuilds from the restored committed inputs. Check the run and open the site to confirm the rollback.

Magic: The Gathering is a trademark of Wizards of the Coast. Lattice MTG is an unofficial project.
