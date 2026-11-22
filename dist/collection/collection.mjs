import {nameKey, uuid, verifyPrinting} from "../printings.mjs";
const headerKey = name => name.trim().toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]/g, "");

export const states = {
  matched: "Matched",
  review: "Needs review",
  token: "Token or emblem",
};

function* csvRows(text, delimiter, legacyQuotes = false) {
  let fields = [], value = "", state = "open";
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (state === "quoted") {
      if (ch === undefined) throw new Error("The CSV ends inside a quoted field.");
      const next = text[i + 1];
      if (legacyQuotes && ch === '"' && next !== delimiter && next !== "\r" && next !== "\n" && next !== undefined) {
        value += ch;
      } else if (ch === '"' && next === '"') {
        value += '"';
        i++;
      } else if (ch === '"') state = "closed";
      else value += ch;
    } else if (ch === delimiter || ch === "\r" || ch === "\n" || ch === undefined) {
      fields.push(value);
      value = "";
      state = "open";
      if (ch !== delimiter) {
        if (fields.some(field => field.trim())) yield fields;
        fields = [];
        if (ch === "\r" && text[i + 1] === "\n") i++;
      }
    } else if (ch === '"' && !value && state === "open") {
      state = "quoted";
    } else {
      if (state === "closed" || ch === '"') throw new Error("Unexpected text next to a quoted CSV field.");
      value += ch;
    }
  }
}

export function parseCollection(text) {
  const clean = text.replace(/^\uFEFF/, "");
  let foundCollectionHeaders = false;
  for (const delimiter of [",", ";", "\t"]) {
    // Choosing the delimiter only requires the header.
    let rows = csvRows(clean, delimiter);
    let first;
    try {
      first = rows.next().value;
    } catch {
      continue;
    }
    if (!first) continue;
    const keys = first.map(headerKey);
    const find = (...names) => names.map(key => keys.indexOf(key)).find(index => index >= 0) ?? -1;
    const name = find("name", "cardname", "card", "cardtitle");
    const quantity = find("quantity", "quantityx", "qty", "count", "amount", "totalqty", "totalquantity", "copies");
    if (name < 0 || quantity < 0) continue;
    foundCollectionHeaders = true;
    const oracle = find("oracleid", "scryfalloracleid", "oracleidscryfall", "oracleuuid");
    const printing = find("scryfallid", "scryfallprintingid", "scryfalluuid", "printingid", "printinguuid");
    if (oracle < 0 && printing < 0) continue;
    if (delimiter === "\t" && keys[quantity] === "quantityx") {
      // This Delver Lens format wraps multiline fields without escaping inner quotes.
      rows = csvRows(clean, delimiter, true);
      rows.next();
    }
    const set = find("editioncode", "setcode", "set");
    const edition = find("edition", "setname");
    const collector = find("collectorsnumber", "collectornumber", "cardnumber");
    const language = find("language", "lang");
    const type = find("cardtype", "typeline", "type");
    const items = [];
    for (const fields of rows) {
      const row = items.length + 1;
      const cardName = (fields[name] ?? "").trim();
      const amount = (fields[quantity] ?? "").trim();
      const count = /^([0-9]+)\s*[x×]?$/i.exec(amount);
      const copies = count ? Number(count[1]) : NaN;
      if (fields.length !== first.length || !cardName || !Number.isSafeInteger(copies) || copies < 1) {
        throw new Error(`CSV record ${row} needs a card name, a positive whole quantity, and ${first.length} fields.`);
      }
      items.push({
        row, name: cardName, quantity: copies,
        ...(edition >= 0 && {editionName: (fields[edition] ?? "").trim()}),
        setCode: (fields[set] ?? "").trim(),
        collectorNumber: (fields[collector] ?? "").trim(),
        printingId: (fields[printing] ?? "").trim().toLowerCase(),
        oracleId: (fields[oracle] ?? "").trim().toLowerCase(),
        language: (fields[language] ?? "").trim(),
        token: /\b(?:token|emblem)$/i.test(cardName) || /^(?:token|emblem)\b/i.test((fields[type] ?? "").trim()),
        fields,
      });
    }
    if (!items.length) throw new Error("The CSV contains a header but no cards.");
    const copies = items.reduce((sum, item) => sum + item.quantity, 0);
    if (!Number.isSafeInteger(copies)) throw new Error("The collection quantity is too large.");
    return {columns: first, items};
  }
  throw new Error(foundCollectionHeaders
    ? "Add an Oracle ID or Scryfall ID column to verify the cards."
    : "Add Name, Quantity, and an Oracle ID or Scryfall ID column.");
}

export function matchCollection(input, catalog, printingIndex) {
  const cards = new Map();
  const byOracle = new Map(catalog.cards.map(card => [card.oracleId, card]));
  const items = input.items.map(({token, ...item}) => {
    const name = nameKey(item.name);
    const matchesCardName = id => {
      const card = byOracle.get(id);
      const aliases = card ? [card.name, ...card.faces.map(face => face.name)].map(nameKey) : [];
      return aliases.includes(name) || (card?.isToken && aliases.includes(name.replace(/ (?:token|emblem)$/, "")));
    };
    const printingCheck = verifyPrinting({...item, token}, printingIndex, matchesCardName);
    const reviewed = reason => ({
      ...item, status: "review", matchBasis: null, oracleIds: [], reason,
      printingStatus: printingCheck.status, printingCheck,
    });
    if (!item.oracleId && !item.printingId) return reviewed("Missing Oracle ID or Scryfall ID.");
    if (item.oracleId && !uuid.test(item.oracleId)) return reviewed("Invalid Oracle ID.");
    if (item.printingId && !uuid.test(item.printingId)) return reviewed("Invalid Scryfall ID.");
    if (item.printingId && printingCheck.status !== "verified") {
      const reason = {
        mismatch: "Scryfall ID conflicts with the name, Oracle ID, or printing details.",
        unavailable: "The Scryfall ID could not be checked. Try importing again.",
        unknown: "Scryfall ID not found in this snapshot.",
      };
      return reviewed(reason[printingCheck.status]);
    }
    if (printingCheck.status === "mismatch") return reviewed("The printing details conflict with the card.");
    const printings = printingCheck.status === "verified" ? printingCheck.matches.map(({record}) => record) : [];
    const ids = new Set(printings.map(record => record.oracleId));
    if (ids.size > 1) return reviewed("Several Oracle identities match this printing. Add the Oracle ID for the card or face.");
    const matchBasis = item.printingId ? "printing_id" : "oracle_id";
    const id = item.oracleId || ids.values().next().value;
    const card = byOracle.get(id);
    if ((printings.length && printings.every(record => record.token)) ||
        (card?.isToken && matchesCardName(id))) {
      if (card) cards.set(id, card);
      return {...item, status: "token", matchBasis, oracleIds: card ? [id] : [],
        printingStatus: printingCheck.status, printingCheck};
    }
    if (!card) return reviewed("Oracle identity not found in the card catalog.");
    if (!printings.length && !matchesCardName(id)) return reviewed("Oracle ID conflicts with the card name.");
    cards.set(id, card);
    return {...item, status: "matched", matchBasis, oracleIds: [id], printingStatus: printingCheck.status, printingCheck};
  });
  const distinct = new Set(items.map(item => nameKey(item.name))).size;
  const copies = items.reduce((sum, item) => sum + item.quantity, 0);
  return {
    schema: "lattice-collection-v1",
    snapshot: catalog.snapshot,
    source: catalog.source,
    ...(printingIndex && {printingSnapshot: printingIndex.snapshot, printingSource: printingIndex.source}),
    summary: {rows: items.length, distinctNames: distinct, copies},
    columns: input.columns,
    items,
    cards: [...cards.values()],
  };
}

function deckInventory(collection) {
  const counts = new Map();
  const review = [];
  const tokens = [];
  for (const item of collection.items) {
    const description = `Row ${item.row}: ${item.name} ×${item.quantity}`;
    if (item.status === "token") {
      tokens.push(description);
    } else if (item.status !== "matched") {
      review.push(`${description} — ${item.reason}`);
    } else {
      const id = item.oracleIds[0];
      counts.set(id, (counts.get(id) ?? 0) + item.quantity);
    }
  }
  const copies = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const cards = collection.cards.filter(card => counts.has(card.oracleId))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  return {counts, copies, cards, tokens, review};
}

function faceDetails(face) {
  return [face.type, face.manaCost, face.power != null ? `${face.power}/${face.toughness}` : null,
    face.loyalty != null ? `Loyalty ${face.loyalty}` : null,
    face.defense != null ? `Defense ${face.defense}` : null].filter(Boolean).join(" · ");
}

export function exportText(collection) {
  const {counts, copies, cards, tokens, review} = deckInventory(collection);
  const lines = [
    "Lattice MTG collection",
    `Source: ${collection.source} (${collection.snapshot})`,
    `Deck inventory: ${counts.size} Oracle identities; ${copies} copies.`,
    "Counts apply to whole cards. A card part is not an extra copy.",
    "A matched Oracle identity can be listed without verified printing details.",
    "Unofficial Magic: The Gathering fan content. Portions © Wizards of the Coast.",
  ];
  for (const card of cards) {
    lines.push("", `=== ${card.name} ===`, `Copies: ${counts.get(card.oracleId)}`, `Oracle ID: ${card.oracleId}`,
      `Layout: ${card.layout}`);
    if (card.catalogManaValue != null) lines.push(`Mana value: ${card.catalogManaValue}`);
    if (card.colorIdentity) lines.push(`Color identity: ${card.colorIdentity.join("") || "colorless"}`);
    for (const face of card.faces) {
      if (card.faces.length > 1) lines.push(`Part: ${face.name}`);
      lines.push(faceDetails(face));
      if (face.oracleText) lines.push(face.oracleText);
    }
  }
  if (tokens.length) lines.push("", "Tokens and emblems outside the deck inventory", ...tokens);
  if (review.length) lines.push("", "Rows outside the deck inventory pending review", ...review);
  return lines.join("\n") + "\n";
}

const cardTypes = [
  ["Creature", "Creatures"], ["Planeswalker", "Planeswalkers"], ["Battle", "Battles"],
  ["Instant", "Instants"], ["Sorcery", "Sorceries"], ["Artifact", "Artifacts"],
  ["Enchantment", "Enchantments"], ["Land", "Lands"],
];
const typeWords = face => face.type.split(" — ", 1)[0].split(" ");
const colorIdentity = card => card.colorIdentity?.join("") || "Colorless";
const tokenHeading = "Tokens and emblems outside the deck inventory";
const reviewHeading = "Rows outside the deck inventory pending review";
const credit = "Unofficial Magic: The Gathering fan content. Portions © Wizards of the Coast.";

function readableInventory(collection) {
  const inventory = deckInventory(collection);
  const {cards, counts, tokens, review} = inventory;
  const groups = new Map([...cardTypes.map(([, title]) => [title, []]), ["Other cards", []]]);
  for (const card of cards) {
    const types = typeWords(card.faces[0]);
    const title = cardTypes.find(([type]) => types.includes(type))?.[1] ?? "Other cards";
    groups.get(title).push(card);
  }
  const sections = [...groups].filter(([, group]) => group.length).map(([title, group]) => ({
    title,
    id: title.toLowerCase().replaceAll(" ", "-"),
    cards: group.sort((a, b) => (a.catalogManaValue ?? Infinity) - (b.catalogManaValue ?? Infinity)),
    copies: group.reduce((total, card) => total + counts.get(card.oracleId), 0),
  }));
  const extras = [
    {title: tokenHeading, id: "tokens-and-emblems", label: "Token or emblem rows", rows: tokens},
    {title: reviewHeading, id: "pending-review", label: "Rows needing review", rows: review},
  ];
  return {...inventory, sections, extras};
}

const copiesLabel = count => `${count} ${count === 1 ? "copy" : "copies"}`;
const groupingNote = "Each card is counted once and grouped by the type of its first part. Within each group, cards are ordered by mana value, then name.";
const escapeHtml = value => String(value).replace(/[&<>"']/g,
  char => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[char]);
const escapeMarkdown = value => String(value).replace(/[\\`*_{}\[\]()#+!|~]/g, "\\$&")
  .replace(/[&<>]/g, escapeHtml);

export function exportMarkdown(collection) {
  const {counts, copies, cards, sections, extras} = readableInventory(collection);
  const lines = [
    "# Lattice MTG collection", "", "## Collection overview", "",
    `**${cards.length} unique playable cards · ${copiesLabel(copies)}**`, "",
    `Oracle snapshot: ${escapeMarkdown(collection.snapshot)} · ${escapeMarkdown(collection.source)}`, "",
    ...extras.map(({label, rows}) => `- ${label}: ${rows.length}`), "",
  ];
  if (sections.length) {
    lines.push("| Card type | Unique cards | Copies |", "| --- | ---: | ---: |",
      ...sections.map(section => `| ${section.title} | ${section.cards.length} | ${section.copies} |`),
      "", groupingNote, "");
  }
  for (const {title, cards: group} of sections) {
    lines.push(`## ${title}`, "");
    for (const card of group) {
      lines.push(`### ${escapeMarkdown(card.name)} · ${copiesLabel(counts.get(card.oracleId))}`, "");
      for (const face of card.faces) {
        if (card.faces.length > 1) lines.push(`#### ${escapeMarkdown(face.name)}`, "");
        lines.push(escapeMarkdown(faceDetails(face)), "");
        if (face.oracleText) {
          lines.push(face.oracleText.split(/\r?\n/).map(line => `> ${escapeMarkdown(line)}`).join("  \n"), "");
        }
      }
      lines.push(`Oracle ID: \`${card.oracleId}\` · Color identity: ${colorIdentity(card)} · Mana value: ${card.catalogManaValue ?? "Unknown"}`, "");
    }
  }
  for (const {title, rows} of extras) {
    if (rows.length) lines.push(`## ${title}`, "", ...rows.map(row => `- ${escapeMarkdown(row)}`), "");
  }
  return lines.join("\n") + credit + "\n";
}

export function exportTsv(collection) {
  const {counts, cards} = deckInventory(collection);
  const rows = [["Name", "Quantity", "Oracle ID", "Type lines", "Mana value", "Color identity"]];
  for (const card of cards) {
    rows.push([card.name, counts.get(card.oracleId), card.oracleId,
      card.faces.map(face => face.type).join(" // "),
      card.catalogManaValue ?? "", colorIdentity(card)]);
  }
  return rows.map(row => row.map(value => {
    const text = String(value).replace(/[\t\r\n]/g, " ");
    return text.includes('"') ? `"${text.replaceAll('"', '""')}"` : text;
  }).join("\t")).join("\n") + "\n";
}

export function exportHtml(collection) {
  const {counts, copies, cards, sections, extras} = readableInventory(collection);
  const typeTable = sections.length ? `<table>
<caption>Cards by type</caption>
<thead><tr><th scope="col">Card type</th><th scope="col">Unique cards</th><th scope="col">Copies</th></tr></thead>
<tbody>${sections.map(section => `<tr><th scope="row"><a href="#${section.id}">${section.title}</a></th><td>${section.cards.length}</td><td>${section.copies}</td></tr>`).join("\n")}</tbody>
</table><p>${groupingNote}</p>` : "";
  const details = sections.map(({title, id, cards: group}) => {
    const entries = group.map(card => {
      const faces = card.faces.map(face => `<section>
${card.faces.length > 1 ? `<h4>${escapeHtml(face.name)}</h4>` : ""}
<p>${escapeHtml(faceDetails(face))}</p>
${face.oracleText ? `<p class="rules">${escapeHtml(face.oracleText)}</p>` : ""}
</section>`).join("\n");
      const legality = Object.entries(card.legality ?? {}).map(([status, formats]) =>
        `<li>${escapeHtml(status.replaceAll("_", " "))}: ${escapeHtml(formats.join(", "))}</li>`).join("");
      return `<article><h3>${escapeHtml(card.name)} · ${copiesLabel(counts.get(card.oracleId))}</h3>
${faces}
<p class="card-meta">Oracle ID: <code>${escapeHtml(card.oracleId)}</code> · Color identity: ${escapeHtml(colorIdentity(card))} · Mana value: ${escapeHtml(card.catalogManaValue ?? "Unknown")}</p>
${legality ? `<details><summary>Format legality</summary><ul>${legality}</ul></details>` : ""}
</article>`;
    }).join("\n");
    return `<section><h2 id="${id}">${title}</h2>\n${entries}\n<p><a href="#overview">Back to overview</a></p></section>`;
  });
  for (const {title, id, rows} of extras) {
    if (rows.length) details.push(`<section><h2 id="${id}">${title}</h2><ul>${
      rows.map(row => `<li>${escapeHtml(row)}</li>`).join("")}</ul></section>`);
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lattice MTG collection</title>
<style>
:root{color-scheme:light dark}
body{font:1rem/1.55 system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;overflow-wrap:anywhere}
article{border-block-start:1px solid GrayText;padding-block:.65rem}
table{width:100%;max-width:32rem;border-collapse:collapse}
caption{text-align:left;font-weight:700;margin-block:.6rem .25rem}
th,td{padding:.35rem .45rem;border-block-end:1px solid GrayText;text-align:right}
th:first-child{text-align:left}
.card-meta{font-size:.875rem}
.rules{white-space:pre-wrap}summary{cursor:pointer}
</style></head><body><main>
<h1>Lattice MTG collection</h1>
<section aria-labelledby="overview">
<h2 id="overview">Collection overview</h2>
<p><strong>${cards.length} unique playable cards · ${copiesLabel(copies)}</strong></p>
<p>Oracle snapshot: ${escapeHtml(collection.snapshot)} · ${escapeHtml(collection.source)}</p>
<ul>${extras.map(({id, label, rows}) => `<li>${rows.length ? `<a href="#${id}">${label}</a>` : label}: ${rows.length}</li>`).join("")}</ul>
${typeTable}
</section>
${details.join("\n")}
<footer><p>${credit}</p></footer>
</main></body></html>\n`;
}

export function exportJsonl(collection) {
  const {items, cards, ...metadata} = collection;
  const line = (type, data) => JSON.stringify({type, data}) + "\n";
  return [line("collection", metadata), ...items.map(item => line("item", item)),
    ...cards.map(card => line("card", card))];
}

export function exportSQLite(SQL, collection) {
  const db = new SQL.Database();
  try {
    db.run(`
      PRAGMA foreign_keys = ON;
      PRAGMA user_version = 1;
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE cards (
        oracle_id TEXT PRIMARY KEY, name TEXT NOT NULL, layout TEXT NOT NULL, card_json TEXT NOT NULL
      );
      CREATE TABLE card_faces (
        oracle_id TEXT NOT NULL REFERENCES cards, position INTEGER NOT NULL,
        name TEXT NOT NULL, type TEXT NOT NULL, mana_cost TEXT, oracle_text TEXT,
        PRIMARY KEY (oracle_id, position)
      );
      CREATE TABLE collection_items (
        row_number INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0),
        set_code TEXT, collector_number TEXT, printing_id TEXT, printing_status TEXT NOT NULL,
        status TEXT NOT NULL, match_basis TEXT, csv_fields_json TEXT NOT NULL
      );
      CREATE TABLE collection_candidates (
        row_number INTEGER NOT NULL REFERENCES collection_items,
        oracle_id TEXT NOT NULL REFERENCES cards, PRIMARY KEY (row_number, oracle_id)
      );
      CREATE TABLE collection_printing_checks (
        row_number INTEGER PRIMARY KEY REFERENCES collection_items,
        check_json TEXT NOT NULL
      );
      BEGIN;
    `);
    function insert(sql, values) {
      const statement = db.prepare(sql);
      try {
        for (const row of values) statement.run(row);
      } finally {
        statement.free();
      }
    }
    insert("INSERT INTO metadata VALUES (?, ?)", [
      ["schema", collection.schema], ["snapshot", collection.snapshot], ["source", collection.source],
      ["summary", JSON.stringify(collection.summary)], ["csv_columns", JSON.stringify(collection.columns)],
      ...(collection.printingSnapshot ? [["printing_snapshot", collection.printingSnapshot], ["printing_source", collection.printingSource]] : []),
    ]);
    insert("INSERT INTO cards VALUES (?, ?, ?, ?)", collection.cards.map(card =>
      [card.oracleId, card.name, card.layout, JSON.stringify(card)]));
    insert("INSERT INTO card_faces VALUES (?, ?, ?, ?, ?, ?)", collection.cards.flatMap(card =>
      card.faces.map((face, index) =>
        [card.oracleId, index, face.name, face.type, face.manaCost ?? null, face.oracleText ?? null])));
    insert("INSERT INTO collection_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", collection.items.map(item =>
      [item.row, item.name, item.quantity, item.setCode || null, item.collectorNumber || null, item.printingId || null,
        item.printingStatus, item.status, item.matchBasis, JSON.stringify(item.fields)]));
    insert("INSERT INTO collection_candidates VALUES (?, ?)", collection.items.flatMap(item =>
      item.oracleIds.map(id => [item.row, id])));
    insert("INSERT INTO collection_printing_checks VALUES (?, ?)", collection.items.map(item =>
      [item.row, JSON.stringify({...item.printingCheck, ...(item.reason && {identityReview: item.reason})})]));
    db.run("COMMIT");
    return db.export();
  } finally {
    db.close();
  }
}
