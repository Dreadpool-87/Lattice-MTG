# Lattice MTG

A static Magic: The Gathering card explorer, collection import tool, HTML catalog, and compact JSON lookup.

- `dist/` contains the complete built site, including the card data snapshot.
- The Python build scripts and HTML template generate the catalog and lookup assets.
- The imported website snapshot is Lattice MTG version 19, source revision `ec746126f3d628e272b4d3f2fd1a162c141cc636`.

## Hosting

Use `dist/` as the root of the website. The catalog uses extensionless HTML links. Configure the host to serve the corresponding `.html` files for those routes. The explorer also uses root-relative paths.

[Live website](https://lattice-mtg-explorer.rustynashi5.chatgpt.site/) · [Scryfall data source](https://scryfall.com/docs/api/bulk-data)

Magic: The Gathering is a trademark of Wizards of the Coast. Lattice MTG is an unofficial project.
