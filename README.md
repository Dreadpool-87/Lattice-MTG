# Lattice MTG

A static Magic: The Gathering card explorer, collection import tool, HTML catalog, and compact JSON lookup.

- `dist/` contains the complete built site, including the card data snapshot.
- The Python build scripts and HTML template generate the catalog and lookup assets.
- The imported website snapshot is Lattice MTG version 19, source revision `ec746126f3d628e272b4d3f2fd1a162c141cc636`.

## Hosting

[GitHub Pages](https://dreadpool-87.github.io/Lattice-MTG/) · [ChatGPT Sites](https://lattice-mtg-explorer.rustynashi5.chatgpt.site/) · [Scryfall data source](https://scryfall.com/docs/api/bulk-data)

The **Publish Lattice MTG** workflow publishes `dist/` on pushes to `main`. It adapts local links to the GitHub Pages base path and adds explicit `.html` extensions to the catalog links during deployment. Publishing uses the committed card snapshot. Refresh the Scryfall data separately before committing a new snapshot.

Magic: The Gathering is a trademark of Wizards of the Coast. Lattice MTG is an unofficial project.
