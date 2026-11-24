# <img src="./docs/lattice-spark-badge.svg" width="32" height="32" alt=""> Lattice MTG

A static Magic: The Gathering card explorer and collection import tool. Card information is available in HTML and compact JSON.

- [Card explorer](https://dreadpool-87.github.io/Lattice-MTG/) searches by card name, Oracle ID, or rules text.
- [Static card catalog](https://dreadpool-87.github.io/Lattice-MTG/cards/) provides Oracle text in HTML without JavaScript.
- [Compact JSON lookup](https://dreadpool-87.github.io/Lattice-MTG/lookup/) documents the card name lookup routes, examples, and checksums.
- [Collection](https://dreadpool-87.github.io/Lattice-MTG/collection/) imports CSV files with a card name, quantity, and Oracle ID or Scryfall ID in the browser.

## Collection downloads

Choose a format and select **Download**. The download uses the whole imported collection regardless of the current view filters.

- **TXT, Markdown, HTML** provide readable inventories. Markdown and offline HTML open with totals by card type. Cards are grouped by the type of their first part, then sorted by mana value and name. HTML links the overview to each group. Tokens and rows needing review are listed separately.
- **TSV** is a compact index of confirmed, playable cards with one row per Oracle identity. **TSV with Oracle text** adds mana costs and rules text for all parts of each card on the same row. In those two columns, backslashes, tabs, and line breaks use the escapes `\\\\`, `\\t`, `\\n`, and `\\r`.
- **JSON, JSON Lines, YAML, SQLite** retain imported rows, printing checks, and card records. YAML uses the same collection structure as JSON. The JSON Lines file is UTF-8 and starts with a `{"type":"collection","data":…}` metadata record, followed by `item` records in import order and `card` records for the linked Oracle identities.

## Web app

Open [Lattice Web](https://dreadpool-87.github.io/Lattice-MTG/app/) for Search, Sets, and Collection in a mobile layout. Search remembers the query and selected card when you switch tabs. **Remember collection on this device** keeps your imported CSV in the same browser for later visits.

- **Android** · Tap **Install app** or use your browser's install menu.
- **iPhone** · In Safari, tap **Share → Add to Home Screen**, then enable **Open as Web App** when shown.

## Set index

[Browse sets](https://dreadpool-87.github.io/Lattice-MTG/sets/) by set code or name. Each set page links to its card entries and JSON file. In the [JSON set index](https://dreadpool-87.github.io/Lattice-MTG/sets/index.json), find the entry by set code and follow its `json` field relative to the index URL.

Set names and card membership come from the printing snapshot. Scryfall supplies release dates. Printings with the same collector number and Oracle ID share one row across languages and finishes. Alternate collector numbers and distinct Oracle IDs get separate rows.

## Official rulings

Lattice uses the Scryfall rulings export and keeps entries attributed to Wizards of the Coast. Oracle text and rulings have separate snapshot dates.

For machine lookup, use the first two characters of an Oracle ID as the filename under `data/rulings/`, with the `.json` extension. Each Oracle ID maps to a list of `[date, comment]` pairs. An absent ID in a successfully retrieved file means the snapshot contains no official ruling entries for that ID. Check the [rulings metadata](https://dreadpool-87.github.io/Lattice-MTG/data/rulings/meta.json) for the snapshot date and source.

## Updates and hosting

[GitHub Pages](https://dreadpool-87.github.io/Lattice-MTG/) hosts the site and web app. The [Publish Lattice MTG workflow](https://github.com/Dreadpool-87/Lattice-MTG/actions/workflows/pages.yml) checks for new data every Sunday at **07:15 Belgian time** (06:15 UTC during standard time or 05:15 UTC during daylight saving time). It checks the paired Oracle Cards and All Cards exports and updates card data, printings, set metadata, and official rulings. It publishes changed data and keeps the last verified version online if a refresh fails. The site shows the next check in the visitor’s local time. Published data changes appear in the [Archive log](https://dreadpool-87.github.io/Lattice-MTG/updates/).

To refresh outside the schedule, run **Publish Lattice MTG** from `main` in GitHub Actions with **Refresh all Scryfall data before publishing** selected. The workflow also publishes after pushes to `main` using the committed data. This regular build can run without contacting Scryfall.

## Build and rollback

Use a clean checkout, Python 3.11+ and Node.js 22+. To build and verify the site for GitHub Pages from the committed snapshots:

```sh
python3 site_data.py build
python3 prepare_pages.py /Lattice-MTG
node verify_site.mjs /Lattice-MTG
```

The build writes to `dist/`. For a local preview, pass an empty base path to `prepare_pages.py` and `verify_site.mjs`, then run `python3 -m http.server --directory dist` and open `http://localhost:8000/`. Start from a clean checkout when switching base paths.

The pre-publication check verifies representative links, card lookups, snapshot data, and CSV imports. To roll back a faulty update, revert its commit or PR on `main` and check the resulting **Publish Lattice MTG** run.

## Credits and licensing

[Credits & Licensing on Lattice MTG](https://dreadpool-87.github.io/Lattice-MTG/credits/) lists the project's data sources and third-party notices.

- [Scryfall](https://scryfall.com/) supplies the [bulk card and ruling data](https://scryfall.com/docs/api/bulk-data) and [set metadata](https://scryfall.com/docs/api/sets).
- [EDHREC](https://edhrec.com/) supplies the Commander popularity ranks included in Scryfall card records.
- [MTGJSON](https://mtgjson.com/) supplied data used by the original build, via [MTGJSON-slim](https://github.com/Dreadpool-87/MTGJSON-slim). The current data refresh uses Scryfall.
- [sql.js](https://github.com/sql-js/sql.js) enables SQLite exports in the browser. The bundled copy retains its [MIT license](dist/collection/vendor/LICENSE.sql.js).

Lattice MTG is an unofficial Magic: The Gathering fan project. Wizards of the Coast has not approved, endorsed, or sponsored it. Portions of the materials used belong to Wizards of the Coast. © Wizards of the Coast LLC. See the [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy).

The Lattice MTG source code currently has no project-wide license. Third-party code and data retain their respective notices and terms.

### Android offline catalog

The Pages build publishes a small manifest at `data/android/manifest.json` and checksummed, gzip-compressed card packs. The Android app can download the full catalog (a representative printing per Oracle card) or a set (a representative language per collector-number and Oracle card combination). Packs are generated from the same committed card and printing snapshots used by the website.
