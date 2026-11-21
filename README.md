# Lattice MTG

A static Magic: The Gathering card explorer, collection import tool, HTML catalog, and compact JSON lookup.

- `dist/` contains the built site and the committed card and printing snapshots. GitHub Pages builds the set and rulings indexes during deployment.
- The Python build scripts and HTML template generate the catalog and lookup assets.
- The imported website snapshot is Lattice MTG version 19, source revision `ec746126f3d628e272b4d3f2fd1a162c141cc636`.

## Hosting

[GitHub Pages](https://dreadpool-87.github.io/Lattice-MTG/) · [ChatGPT Sites](https://lattice-mtg-explorer.rustynashi5.chatgpt.site/) · [Scryfall data source](https://scryfall.com/docs/api/bulk-data)

The **Publish Lattice MTG** workflow publishes `dist/` on pushes to `main`. It adapts local links to the GitHub Pages base path and adds explicit `.html` extensions to the catalog links during deployment. Publishing uses the committed card snapshot. Refresh the Scryfall data separately before committing a new snapshot.

### Set index

[Browse sets](https://dreadpool-87.github.io/Lattice-MTG/sets/) by set code or name. Each set page links to its card entries and its JSON file. The [JSON set index](https://dreadpool-87.github.io/Lattice-MTG/sets/index.json) links to a JSON file for each set, such as [M19](https://dreadpool-87.github.io/Lattice-MTG/sets/m19/index.json). Resolve relative URLs against the file they appear in.

Set names and card membership come from the committed printing snapshot. Scryfall supplies release dates. A collector number and Oracle ID share one row across languages and finishes. Alternate collector numbers and distinct Oracle IDs are listed separately.

### Official rulings

During publication, Lattice imports the Scryfall rulings export and keeps entries attributed to Wizards of the Coast. The rules text and rulings snapshots have separate dates.

For machine lookup, use the first two characters of an Oracle ID as the file name under `data/rulings/`. For example, [`d2.json`](https://dreadpool-87.github.io/Lattice-MTG/data/rulings/d2.json) contains Kenrith, the Returned King under Oracle ID `d209b948-9afb-4fd1-a961-72c87282878c`. Each record is a list of `[date, comment]` pairs. An absent ID in a successfully retrieved file has no official ruling entries in that snapshot. See [`meta.json`](https://dreadpool-87.github.io/Lattice-MTG/data/rulings/meta.json) for the snapshot date and source.

Magic: The Gathering is a trademark of Wizards of the Coast. Lattice MTG is an unofficial project.
