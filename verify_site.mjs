import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { matchCollection, parseCollection } from "./dist/collection/collection.mjs";
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
for (const route of ["cards/", "collection/", "lookup/", "sets/", "updates/"]) {
  const href = `${basePath}/${route}`;
  assert.ok(index.includes(`href="${href}"`), `Missing homepage link ${href}`);
  resolveLink(href, "index.html");
}
for (const route of ["browse/", "../data/tokens.json.gz", "../sets/", "../data/rulings/meta.json"]) {
  assert.ok(read("lookup/index.html").includes(`href="${route}"`));
  resolveLink(route, "lookup/index.html");
}

const updates = read("updates/index.html");
const adminUrl = 'href="https://lattice-mtg-admin.dreadpool.workers.dev/"';
assert.ok(!index.includes(adminUrl), "Admin link should stay off the homepage");
assert.ok(updates.includes(adminUrl), "Data updates should link to the protected admin page");
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

console.log("Verified Pages links, lookup fixtures, snapshots, checksum, and CSV import.");
