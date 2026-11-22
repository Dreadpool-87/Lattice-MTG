import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { exportHtml, exportJsonl, exportMarkdown, exportText, exportTsv, matchCollection, parseCollection } from "./dist/collection/collection.mjs";
import { makePrintingIndex } from "./dist/printings.mjs";

const dist = fileURLToPath(new URL("./dist/", import.meta.url));
const basePath = (process.argv[2] ?? "").replace(/\/$/, "");
const read = path => readFileSync(join(dist, path), "utf-8");
const json = path => JSON.parse(read(path));

function resolveLink(href, page) {
  const url = new URL(href, `https://lattice.invalid${basePath}/${page}`);
  assert.ok(url.pathname.startsWith(`${basePath}/`), `Link leaves the site base path: ${href}`);
  const target = url.pathname.slice(basePath.length + 1);
  const file = target.endsWith("/") || !target ? `${target}index.html` : target;
  assert.ok(existsSync(join(dist, file)), `Missing target ${file} from ${page}`);
  if (url.hash) {
    assert.ok(read(file).includes(`id="${url.hash.slice(1)}"`), `Missing anchor ${url.hash} in ${file}`);
  }
  return file;
}

function lookup(key, exactName) {
  const prefix = key.slice(0, 4);
  const first = json(`lookup/${prefix}.json`);
  const file = first.routes?.[key] ?? `${prefix}.json`;
  if (first.routes && !first.routes[key]) return [];
  const payload = json(`lookup/${file}`);
  assert.ok(Array.isArray(payload.cards) && payload.cards.length <= 8, `Invalid lookup payload ${file}`);
  return payload.cards.filter(card => card.name === exactName);
}

// The existing browse links are the authority when a calculated prefix cannot be read.
const browse = read("lookup/browse/index.html");
assert.ok(browse.includes('href="li.html"') && browse.includes('href="zz.html"'));
assert.ok(read("lookup/browse/li.html").includes('href="../ligh.json"'));
assert.ok(!read("lookup/browse/zz.html").includes('href="../zzzz.json"'));
assert.ok(!existsSync(join(dist, "lookup/zzzz.json")));
assert.deepEqual(lookup("lightlatticemissing0000", "Light Lattice Missing 0000"), []);

const boltId = "4457ed35-7c10-48c8-9776-456485fdf070";
const [bolt] = lookup("lightningbolt", "Lightning Bolt");
assert.equal(bolt?.oracleId, boltId);
assert.match(bolt.faces[0].oracleText, /3 damage/);
const sameNames = lookup("everythingamajig", "Everythingamajig").map(card => card.oracleId);
assert.equal(sameNames.length, 6);
assert.equal(new Set(sameNames).size, 6);
const [split] = lookup("fireice", "Fire // Ice");
assert.ok(split?.faces.every(face => face.oracleText));
assert.deepEqual(split.faces.map(face => face.name), ["Fire", "Ice"]);
const boltFile = json("lookup/ligh.json").routes.lightningbolt;
const expected = json("lookup/integrity/li.json").files[boltFile].sha256;
assert.equal(createHash("sha256").update(read(`lookup/${boltFile}`)).digest("hex"), expected);

const index = read("index.html");
for (const route of ["cards/", "collection/", "lookup/", "updates/"]) {
  const href = `${basePath}/${route}`;
  assert.ok(index.includes(`href="${href}"`), `Missing homepage link ${href}`);
  resolveLink(href, "index.html");
}
assert.ok(!index.includes(`href="${basePath}/sets/"`), "Browse by set belongs in the card catalog");
const catalog = read("cards/index.html");
const setLink = catalog.match(/<a href="([^"]+)" class="start-option catalog-set-link">/);
assert.ok(setLink, "Missing Browse by set tile in the card catalog");
assert.equal(resolveLink(setLink[1], "cards/index.html"), "sets/index.html");
assert.doesNotMatch(catalog, />\s*(Lightning Bolt|Blood Crypt|Splinter Twin)<\/a>/);
for (const route of ["browse/", "parts/", "../data/tokens.json.gz", "../sets/", "../data/rulings/meta.json"]) {
  assert.ok(read("lookup/index.html").includes(`href="${route}"`));
  resolveLink(route, "lookup/index.html");
}

const partsIndex = "lookup/parts/index.html";
const partsGuide = read(partsIndex);
assert.equal(resolveLink("se.html#seedsuture", partsIndex), "lookup/parts/se.html");
assert.ok(partsGuide.includes('href="se.html#seedsuture"'));
for (const [prefix, key, name, label, expectedCards] of [
  ["se", "seedsuture", "Seed Suture", "Prepare spell", [
    "Blossom-Blessed Angel // Seed Suture",
    "Emergency Phytomedic // Seed Suture",
    "Vigorbloom Vanguard // Seed Suture",
  ]],
  ["pe", "pettytheft", "Petty Theft", "Adventure", ["Brazen Borrower // Petty Theft"]],
  ["in", "insectileaberration", "Insectile Aberration", "Card face",
    ["Delver of Secrets // Insectile Aberration"]],
]) {
  const page = `lookup/parts/${prefix}.html`;
  const section = read(page).split(`<section id="${key}">`)[1]?.split("</section>")[0];
  assert.ok(section?.includes(`<h2>${name}</h2>`), `Missing card part ${name}`);
  const matches = Array.from(section.matchAll(/<li><a href="([^"]+)">([^<]+)<\/a> · ([^<]+) · <code>([^<]+)<\/code><\/li>/g));
  for (const cardName of expectedCards) {
    const [, href, , , id] = matches.find(match => match[2] === cardName && match[3] === label) ?? [];
    assert.ok(href, `Missing ${label} link for ${cardName}`);
    const card = json(resolveLink(href, page)).cards.find(record => record.oracleId === id);
    assert.equal(card?.name, cardName);
    assert.ok(card.faces.some(face => face.name === name));
  }
}

const homepageBrand = index.match(/<a [^>]*class="brand"[^>]*>.*?<\/a>/)?.[0];
const logoHref = `${basePath}/lattice-spark.svg`;
assert.ok(homepageBrand?.includes(`src="${logoHref}"`), "Missing Lattice Spark logo");
assert.equal(resolveLink(logoHref, "index.html"), "lattice-spark.svg");
const assetVersion = path => createHash("sha256")
  .update(readFileSync(join(dist, path))).digest("hex").slice(0, 12);
const themeScript = `${basePath}/theme.js?v=${assetVersion("theme.js")}`;
const styleVersion = assetVersion("styles.css");
const collectionStyle = `${basePath}/collection/collection.css?v=${assetVersion("collection/collection.css")}`;
const collectionPage = read("collection/index.html");
const collectionScript = `${basePath}/collection/page.mjs?v=${assetVersion("collection/page.mjs")}`;
assert.ok(collectionPage.includes(`href="${collectionStyle}"`));
assert.ok(collectionPage.includes(`src="${collectionScript}"`));
assert.ok(read("collection/page.mjs").includes(`"./collection.mjs?v=${assetVersion("collection/collection.mjs")}"`));
for (const extension of ["txt", "json", "sqlite", "md", "tsv", "tsv-oracle", "html", "jsonl", "yaml"]) {
  assert.ok(collectionPage.includes(`<option value="${extension}">`));
}
assert.equal(resolveLink(themeScript, "index.html"), "theme.js");
for (const path of readdirSync(dist, {recursive: true}).filter(path => path.endsWith(".html"))) {
  const html = read(path);
  assert.ok(html.includes('<script src="' + themeScript + '"></script>'),
    "Missing color theme selector in " + path);
  const stylesheet = html.match(/href="([^"?]*\/styles\.css)(\?[^"]*)?"/);
  assert.equal(stylesheet?.[2], `?v=${styleVersion}`, `Incorrect stylesheet version in ${path}`);
  assert.equal(resolveLink(stylesheet[1], path), "styles.css");
  const header = html.match(/<header class="sitebar">[\s\S]*?<\/header>/)?.[0];
  assert.ok(header?.includes(homepageBrand), `Missing shared Lattice header in ${path}`);
  assert.ok(html.includes(`rel="icon" type="image/svg+xml" href="${logoHref}"`),
    `Missing Lattice Spark favicon in ${path}`);
}

const updates = read("updates/index.html");
const adminUrl = 'href="https://lattice-mtg-admin.dreadpool.workers.dev/"';
assert.ok(!index.includes(adminUrl), "Admin link should stay off the homepage");
assert.ok(updates.match(/<header class="sitebar">[\s\S]*?<\/header>/)?.[0].includes(adminUrl),
  "Data updates should link to the protected admin page from the header");
assert.ok(updates.includes('href="history.json"'));
resolveLink("history.json", "updates/index.html");
const history = json("updates/history.json");
assert.ok(Array.isArray(history) && history.length > 0);
let previousUpdate = Infinity;
for (const {recordedAt, changes} of history) {
  const timestamp = Date.parse(recordedAt);
  assert.ok(timestamp <= previousUpdate && updates.includes(`datetime="${recordedAt}"`));
  previousUpdate = timestamp;
  for (const dataset of ["oracle", "printings", "sets", "rulings"]) {
    for (const field of ["added", "changed", "removed"]) {
      const value = changes[dataset][field];
      if (dataset === "rulings" && field === "changed") {
        assert.equal(value, null);
      } else {
        assert.ok(Number.isSafeInteger(value) && value >= 0, `Invalid ${dataset} ${field}`);
      }
    }
  }
}

const sets = json("sets/index.json");
const m19 = sets.sets.find(set => set.code === "M19");
const m19Cards = json(resolveLink(m19.json, "sets/index.json"));
assert.equal(m19Cards.snapshot, sets.snapshot);
assert.equal(m19Cards.entries, m19Cards.cards.length);
const printing = m19Cards.cards.find(card => card.url.startsWith("../../cards/"));
resolveLink(printing.url, "sets/m19/index.json");
const rulings = json("data/rulings/meta.json");
const kenrith = "d209b948-9afb-4fd1-a961-72c87282878c";
assert.ok(json("data/rulings/d2.json")[kenrith]?.length);
const guide = read("lookup/index.html");
assert.ok(guide.includes(`snapshot ${sets.metadataSnapshot}`));
assert.ok(guide.includes(`snapshot ${rulings.snapshot}`));

const gzipJson = path => JSON.parse(gunzipSync(readFileSync(join(dist, path))));
const tokens = gzipJson("data/tokens.json.gz");
const treasure = tokens.find(card => card.name === "Treasure");
assert.ok(treasure?.isToken);
assert.ok(lookup("treasure", "Treasure").every(card => card.oracleId !== treasure.oracleId));
const m19Printings = gzipJson("data/printings/set-m19.json.gz");
const strike = lookup("lightningstrike", "Lightning Strike")[0];
const m19Strike = m19Printings.find(row => row[1] === strike.oracleId && row[4] === "en");
const printIndex = makePrintingIndex(json("data/printings/meta.json"), [m19Strike]);
const printingCsv = parseCollection(`Name,Quantity,Scryfall ID\nLightning Strike,1,${m19Strike[0]}`);
const printed = matchCollection(printingCsv, {snapshot: sets.snapshot, cards: [strike]}, printIndex);
assert.equal(printed.items[0].status, "matched");
assert.equal(printed.items[0].matchBasis, "printing_id");

const header = "Name,Quantity,Oracle ID";
const input = parseCollection(`${header}\nLightning Bolt,2,${boltId}\nTreasure,1,${treasure.oracleId}`);
const collection = matchCollection(input, {snapshot: sets.snapshot, cards: [bolt, treasure]}, null);
assert.deepEqual(collection.items.map(item => item.status), ["matched", "token"]);
assert.equal(collection.summary.copies, 3);
assert.throws(() => parseCollection(`${header}\nLightning Bolt,0,${boltId}`), /positive whole quantity/);
assert.throws(() => parseCollection("Name,Quantity\nLightning Bolt,2"), /an Oracle ID or Scryfall ID/);

const exportInput = parseCollection(`${header}\nLightning Bolt,2,${boltId}\nTreasure,1,${treasure.oracleId}\n<script>,1,${boltId}`);
const exportCollection = matchCollection(exportInput, {snapshot: sets.snapshot, source: "Scryfall", cards: [bolt, treasure]}, null);
const {items, cards, ...metadata} = exportCollection;
const jsonl = exportJsonl(exportCollection).join("").trimEnd().split("\n").map(line => JSON.parse(line));
assert.deepEqual(jsonl, [
  {type: "collection", data: metadata},
  ...items.map(data => ({type: "item", data})),
  ...cards.map(data => ({type: "card", data})),
]);
const indexRows = parseCollection(exportTsv(exportCollection)).items;
assert.deepEqual(indexRows.map(row => [row.oracleId, row.quantity]), [[boltId, 2]]);
const markdown = exportMarkdown(exportCollection);
assert.match(markdown, /Collection overview[\s\S]*\| Instants \| 1 \| 2 \|[\s\S]*## Instants\n\n### Lightning Bolt · 2 copies/);
assert.match(markdown, /Token or emblem rows: 1\n- Rows needing review: 1/);
assert.match(markdown, /Tokens and emblems outside the deck inventory/);
const offlineHtml = exportHtml(exportCollection);
assert.match(offlineHtml, /<h3>Lightning Bolt · 2 copies<\/h3>/);
assert.match(offlineHtml, /<a href="#instants">Instants<\/a><\/th><td>1<\/td><td>2<\/td>/);
assert.match(offlineHtml, /<h2 id="instants">Instants<\/h2>/);
assert.match(offlineHtml, /&lt;script&gt;/);
assert.doesNotMatch(offlineHtml, /<script/);
assert.match(offlineHtml, /Format legality/);

const multiInput = parseCollection(`${header}\nFire // Ice,1,${split.oracleId}\nLightning Strike,3,${strike.oracleId}\nLightning Bolt,2,${boltId}`);
const multi = matchCollection(multiInput, {snapshot: sets.snapshot, source: "Scryfall", cards: [split, strike, bolt]}, null);
const multiMarkdown = exportMarkdown(multi);
const oracleTsv = exportTsv(multi, {includeOracle: true});
const oracleRows = parseCollection(oracleTsv);
assert.deepEqual(oracleRows.columns.slice(-2), ["Mana costs", "Oracle text"]);
assert.equal(oracleTsv.trimEnd().split("\n").length, 4);
const splitRow = oracleRows.items.find(item => item.oracleId === split.oracleId);
assert.equal(splitRow.quantity, 1);
assert.match(splitRow.fields.at(-2), /^Fire: .+\\nIce: .+/);
assert.match(splitRow.fields.at(-1), /^Fire: .+\\nIce: .+/);
assert.match(multiMarkdown, /\| Instants \| 3 \| 6 \|/);
assert.match(multiMarkdown, /### Lightning Bolt[\s\S]*### Lightning Strike[\s\S]*### Fire \/\/ Ice · 1 copy[\s\S]*#### Fire[\s\S]*#### Ice/);

if (json("data/meta.json").deckDataVersion) {
  const [tower] = lookup("commandtower", "Command Tower");
  const [tomb] = lookup("ancienttomb", "Ancient Tomb");
  assert.deepEqual([...tower.producedMana].sort(), ["B", "G", "R", "U", "W"]);
  assert.deepEqual(tomb.producedMana, ["C"]);
  const inputWithMana = parseCollection(`${header}\nAncient Tomb,1,${tomb.oracleId}`);
  const publishedCatalog = gzipJson("collection/catalog.json.gz");
  const exported = matchCollection(inputWithMana, publishedCatalog, null);
  assert.deepEqual(exported.cards[0].producedMana, ["C"]);
  for (const exportFile of [exportText, exportMarkdown, exportHtml]) {
    assert.match(exportFile(exported), /Possible mana: C/);
  }
  const tsv = parseCollection(exportTsv(exported, {includeOracle: true}));
  assert.equal(tsv.items[0].fields[tsv.columns.indexOf("Possible mana")], "C");
  const [fableId] = json("data/index.json").find(row => row[1] === "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki");
  const fable = json(`data/cards-${Math.floor(fableId / 128)}.json`)[fableId];
  assert.ok(fable.relatedCards.some(part => part.name === "Goblin Shaman" && part.component === "token"));
  assert.ok(fable.relatedCards.every(part => part.name !== fable.name && part.oracleId !== fable.oracleId));
}
if (sets.sets.some(set => set.setType)) {
  assert.match(read("sets/index.html"), /Filter by set type/);
  assert.equal(resolveLink("type-minigame.html", "sets/index.html"), "sets/type-minigame.html");
  assert.match(read("sets/type-minigame.html"), /href="mltr\/"/);
  const minigames = json("sets/mltr/index.json");
  assert.equal(minigames.setType, "minigame");
  assert.equal(minigames.parentSetCode, "LTR");
  assert.match(read("sets/mltr/index.html"), /Parent set <a href="\.\.\/ltr\//);
  resolveLink("../ltr/", "sets/mltr/index.html");
}

console.log("Verified Pages links, lookup fixtures, snapshots, checksum, and collection import and exports.");
