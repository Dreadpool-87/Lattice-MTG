import {
  parseCollection, matchCollection, exportText, exportMarkdown, exportTsv, exportHtml, exportJsonl, exportSQLite, states,
} from "./collection.mjs";
import {gathererPrintingUrl, gathererSearchUrl, loadPrintingIndex, nameKey, printingStates, readGzipJson, scryfallUrl} from "../printings.mjs";

const el = id => document.getElementById(id);
const format = new Intl.NumberFormat("en");
const pageSize = 30;
const sessionKey = "lattice.collection.v1";
const file = el("csv-file");
const filterSelects = Array.from(el("collection-filters").querySelectorAll("select"));
let catalog, sqlite, collection, groups = [], cards, page = 0, importId = 0, filename, retrySource;

function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  if (className) element.className = className;
  return element;
}

function loadSQLite() {
  sqlite ??= new Promise((resolve, reject) => {
    const script = node("script");
    script.src = "/collection/vendor/sql-wasm.js";
    script.onload = async () => {
      try {
        resolve(await globalThis.initSqlJs({locateFile: name => "/collection/vendor/" + name}));
      } catch (error) {
        reject(error);
      }
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("SQLite download failed."));
    };
    document.head.append(script);
  }).catch(error => { sqlite = undefined; throw error; });
  return sqlite;
}

function updateGroups() {
  const byName = new Map();
  for (const item of collection.items) {
    const key = item.name.normalize("NFC").toLowerCase() + "\0" + item.status;
    if (!byName.has(key)) byName.set(key, {name: item.name, status: item.status, quantity: 0, items: []});
    const group = byName.get(key);
    group.quantity += item.quantity;
    group.items.push(item);
  }
  groups = [...byName.values()].sort(compareName);
  cards = new Map(collection.cards.map(card => [card.oracleId, card]));
}

function renderFaces(card, target, showTitle) {
  if (showTitle) target.append(node("h3", card.name));
  const link = node("a", "Open in Card Explorer", "collection-card-link");
  link.setAttribute("aria-label", `Open ${card.name} in Card Explorer`);
  link.href = "/?card=" + encodeURIComponent(card.oracleId);
  target.append(link);
  for (const face of card.faces) {
    const details = node("article", undefined, "face");
    const label = [face.type, face.manaCost, face.power && `${face.power}/${face.toughness}`].filter(Boolean).join(" · ");
    details.append(node("h3", face.name), node("p", label, "hint"));
    if (face.oracleText) details.append(node("p", face.oracleText, "rules"));
    target.append(details);
  }
}

function externalLink(label, url) {
  const link = node("a", label, "collection-card-link");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

function commanderRole(card) {
  if (card?.isToken || !card?.legality?.legal?.includes("commander")) return "";
  const front = card.faces[0];
  const [typeLine, subtypeLine = ""] = front.type.split(" — ", 2);
  const types = typeLine.split(" ");
  const subtypes = subtypeLine.split(" ");
  const hasPrintedStats = front.power != null && front.toughness != null;
  // Grist, the Hunger Tide is a legendary creature outside the battlefield.
  if (card.oracleId === "0efb0d7e-dea0-4817-a243-15066e9ef333"
    || front.oracleText?.split("\n").includes(`${front.name} can be your commander.`)
    || (types.includes("Legendary") && (types.includes("Creature")
      || (hasPrintedStats && (subtypes.includes("Vehicle") || subtypes.includes("Spacecraft")))))) {
    return "commander";
  }
  if (types.includes("Legendary") && types.includes("Enchantment") && subtypes.includes("Background")) {
    return "background";
  }
  return "";
}

function rowDetails(group) {
  const details = node("details");
  const summary = node("summary");
  summary.append(node("strong", group.name), node("span", `×${format.format(group.quantity)}`, "tag"));
  if (group.status !== "matched") {
    summary.append(node("span", states[group.status], "tag"));
  } else {
    const roles = new Set(group.items.flatMap(item => item.oracleIds.map(id => commanderRole(cards.get(id)))));
    if (roles.size === 1 && roles.has("commander")) {
      summary.append(node("span", "Commander", "tag commander-eligibility"));
    } else if (roles.size === 1 && roles.has("background")) {
      summary.append(node("span", "Background co-commander", "tag commander-eligibility"));
    } else if (roles.has("commander") || roles.has("background")) {
      summary.append(node("span", "Commander eligibility varies", "tag commander-eligibility"));
    }
  }
  details.append(summary);
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    const ids = new Set(group.items.flatMap(item => item.oracleIds));
    if (ids.size) {
      const faces = node("div", undefined, "collection-faces");
      for (const id of ids) renderFaces(cards.get(id), faces, ids.size > 1);
      details.append(faces);
    }
    if (group.status === "token") details.append(node("p", "Tracked separately from deck inventory.", "hint"));
    const list = node("ul", undefined, "collection-entries");
    const directGatherer = new Set();
    for (const item of group.items) {
      const matches = item.printingCheck.matches ?? [];
      const verified = item.printingStatus === "verified";
      const primary = verified && matches.length === 1 ? matches[0].record : null;
      const set = primary?.setCode || item.setCode.toUpperCase() || item.editionName;
      const number = primary?.collectorNumber || item.collectorNumber;
      const printing = [set, number && "#" + number].filter(Boolean).join(" ");
      const row = node("li", undefined, "collection-printing");
      const heading = node("div", undefined, "collection-printing-header");
      heading.append(node("span", `×${format.format(item.quantity)}`, "collection-printing-quantity"));
      if (printing) heading.append(node("strong", printing));
      if (item.printingId || (item.setCode && item.collectorNumber)) {
        const status = node("span", printingStates[item.printingStatus], "tag printing-status");
        status.dataset.status = item.printingStatus;
        heading.append(status);
      }
      row.append(heading);
      if (item.reason) row.append(node("p", item.reason, "hint"));
      for (const {record, conflicts} of matches) {
        const identity = primary ? "" : `Index match · ${record.setCode} #${record.collectorNumber}`;
        const printedName = record.printedName && (!primary || nameKey(record.printedName) !== nameKey(group.name))
          ? record.printedName : "";
        const description = [identity, printedName, record.language.toUpperCase()].filter(Boolean).join(" · ");
        const metadata = node("div", undefined, "printing-match");
        if (description) metadata.append(node("p", description, "hint"));
        if (conflicts.length) metadata.append(node("p", "Differs in " + conflicts.join(", "), "hint"));
        const links = node("div", undefined, "collection-links");
        const scryfall = scryfallUrl(record.printingId);
        if (scryfall) links.append(externalLink("Scryfall", scryfall));
        const gatherer = gathererPrintingUrl(record.multiverseId);
        if (gatherer && verified && item.oracleIds.includes(record.oracleId)) {
          links.append(externalLink("Gatherer", gatherer));
          directGatherer.add(record.oracleId);
        }
        if (links.childElementCount) metadata.append(links);
        if (metadata.childElementCount) row.append(metadata);
      }
      list.append(row);
    }
    details.append(list);
    const searches = node("div", undefined, "collection-links collection-gatherer");
    for (const id of ids) {
      const card = cards.get(id);
      if (card.isToken || directGatherer.has(id)) continue;
      const label = ids.size > 1 ? `Search Gatherer for ${card.name}` : "Search Gatherer";
      searches.append(externalLink(label, gathererSearchUrl(card.name)));
    }
    if (searches.childElementCount) details.append(searches);
  }, {once: true});
  return details;
}

const compareName = (a, b) => a.name.localeCompare(b.name, "en");
const supertypes = new Set(["Basic", "Legendary", "Ongoing", "Snow", "World"]);
const typesFor = card => card.faces.flatMap(face => face.type.split(" — ")[0].split(" "));
const setFor = item => item.printingStatus === "verified"
  ? item.printingCheck.matches[0].record.setCode.toUpperCase()
  : item.setCode.toUpperCase() || item.editionName || "";
const manaValue = card => card.isToken ? undefined : card.catalogManaValue;

function populateFilters() {
  const availableTypes = new Set(Array.from(cards.values()).flatMap(typesFor));
  const manaValues = new Set(Array.from(cards.values(), manaValue).filter(Number.isFinite));
  const sets = new Set(collection.items.map(setFor).filter(Boolean));
  const options = [
    ["card-type", [...availableTypes].filter(type => type && !supertypes.has(type)).sort()],
    ["mana-value", [...manaValues].sort((a, b) => a - b).map(String)],
    ["card-set", [...sets].sort((a, b) => a.localeCompare(b, "en"))],
  ];
  for (const [id, values] of options) {
    const select = el(id);
    select.replaceChildren(select.options[0], ...values.map(value => new Option(value, value)));
  }
}

function matchesColor(colors, color) {
  if (!color) return true;
  if (!colors) return false;
  if (color === "colorless") return colors.length === 0;
  if (color === "multicolor") return colors.length > 1;
  return colors.includes(color);
}

function matchingGroups({search, status, printingStatus, type, color, mana, set}) {
  const found = [];
  for (const group of groups) {
    if (status && group.status !== status) continue;
    if (!group.name.normalize("NFC").toLowerCase().includes(search)) continue;
    const items = group.items.filter(item =>
      (!printingStatus || item.printingStatus === printingStatus) &&
      (!set || setFor(item) === set) &&
      (!(type || color || mana) || item.oracleIds.some(id => {
        const card = cards.get(id);
        return (!type || typesFor(card).includes(type)) &&
          matchesColor(card.cardColors, color) &&
          (!mana || manaValue(card) === Number(mana));
      })));
    if (items.length) {
      found.push({...group, items, quantity: items.reduce((sum, item) => sum + item.quantity, 0)});
    }
  }
  return found;
}

function sortGroups(found, order) {
  if (order === "name-desc") return found.sort((a, b) => compareName(b, a));
  if (order.startsWith("quantity")) {
    const direction = order === "quantity-asc" ? 1 : -1;
    return found.sort((a, b) => direction * (a.quantity - b.quantity) || compareName(a, b));
  }
  if (order.startsWith("mana")) {
    const direction = order === "mana-asc" ? 1 : -1;
    const values = new Map(found.map(group => [group, group.items.flatMap(item => item.oracleIds)
      .map(id => manaValue(cards.get(id))).filter(Number.isFinite)
      .reduce((lowest, value) => Math.min(lowest, value), Infinity)]));
    return found.sort((a, b) => {
      const left = values.get(a), right = values.get(b);
      if (left === right) return compareName(a, b);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return left < right ? -1 : 1;
      return direction * (left - right);
    });
  }
  return found;
}

function render() {
  const search = el("filter").value.trim().normalize("NFC").toLowerCase();
  const found = sortGroups(matchingGroups({
    search,
    status: el("match-status").value,
    printingStatus: el("printing-status").value,
    type: el("card-type").value,
    color: el("card-color").value,
    mana: el("mana-value").value,
    set: el("card-set").value,
  }), el("sort-order").value);
  const active = filterSelects.filter(select => select.value).length;
  el("filter-summary").textContent = active ? `Filters (${active})` : "Filters";
  el("reset-filters").disabled = !active && !search;
  const copies = found.reduce((sum, group) => sum + group.quantity, 0);
  el("filter-results").textContent = `${format.format(found.length)} card ${found.length === 1 ? "group" : "groups"} · ${format.format(copies)} ${copies === 1 ? "copy" : "copies"}`;
  const start = page * pageSize;
  const visible = found.slice(start, start + pageSize);
  el("cards").replaceChildren(...(visible.length ? visible.map(rowDetails) :
    [node("p", "No cards match your filters.", "empty")]));
  el("pages").hidden = found.length <= pageSize;
  el("page").textContent = `${start + 1}–${Math.min(start + pageSize, found.length)} of ${format.format(found.length)}`;
  el("previous").disabled = page === 0;
  el("next").disabled = start + pageSize >= found.length;
}

function resetFilters() {
  el("filter").value = "";
  for (const select of filterSelects) select.value = "";
  page = 0;
}

const importStatus = el("import-status");
const retryImport = el("retry-import");
const clearCollection = el("clear-collection");
const sessionStatus = el("session-status");

function removeSavedCollection() {
  try {
    sessionStorage.removeItem(sessionKey);
    return true;
  } catch {
    return false;
  }
}

function saveCollection(name, csv) {
  try {
    sessionStorage.setItem(sessionKey, JSON.stringify({name, csv}));
    return true;
  } catch {
    removeSavedCollection();
    return false;
  }
}

async function importCollection(selected, restoring = false) {
  const run = ++importId;
  retrySource = {selected, restoring};
  clearCollection.hidden = false;
  retryImport.hidden = true;
  importStatus.classList.remove("warning");
  importStatus.textContent = `${restoring ? "Restoring" : "Reading"} ${selected.name}…`;
  try {
    const csv = await selected.text();
    if (run !== importId) return;
    const input = parseCollection(csv);
    importStatus.textContent = `Checking cards in ${selected.name}…`;
    catalog ??= Promise.all([readGzipJson("/collection/catalog.json.gz"), readGzipJson("/data/tokens.json.gz")])
      .then(([snapshot, tokens]) => ({...snapshot, cards: [...snapshot.cards, ...tokens]}))
      .catch(error => { catalog = undefined; throw error; });
    const snapshot = await catalog;
    if (run !== importId) return;
    const hasPrintingIds = input.items.some(item => item.printingId || (item.setCode && item.collectorNumber));
    const printing = hasPrintingIds ? await loadPrintingIndex(input.items).catch(() => null) : null;
    if (run !== importId) return;
    if (collection && hasPrintingIds && !printing) {
      throw new Error("The printing index could not be loaded. Try again.");
    }
    collection = matchCollection(input, snapshot, printing);
    filename = selected.name.replace(/\.csv$/i, "") + "-lattice";
    updateGroups();
    populateFilters();
    resetFilters();
    el("sort-order").value = "";
    const {rows, copies} = collection.summary;
    const confirmed = collection.items.reduce((count, item) => count + (item.status === "matched" ? item.quantity : 0), 0);
    el("summary").textContent = `${format.format(confirmed)} confirmed deck copies · ${format.format(copies)} submitted copies · ${format.format(rows)} rows`;
    el("snapshot").textContent = `Oracle snapshot · ${snapshot.snapshot}` +
      (printing ? ` · Printings snapshot · ${printing.snapshot}` : "");
    const verified = collection.items.filter(item => item.printingStatus === "verified").length;
    el("printing-summary").textContent = hasPrintingIds
      ? `${format.format(verified)} of ${format.format(collection.items.filter(item => item.printingId || (item.setCode && item.collectorNumber)).length)} printing rows verified` : "";
    const issues = collection.items.filter(item => item.status === "review").length;
    const tokens = groups.filter(group => group.status === "token").length;
    const notes = [];
    if (issues) notes.push(`${issues} ${issues === 1 ? "row needs" : "rows need"} review.`);
    if (tokens) notes.push(`${tokens} token or emblem ${tokens === 1 ? "name" : "names"} included separately.`);
    if (hasPrintingIds && !printing) notes.push("The printing index could not be loaded. Import again to retry.");
    el("warning").textContent = notes.join(" ");
    el("warning").hidden = !notes.length;
    retrySource = undefined;
    if (!restoring) {
      sessionStatus.textContent = saveCollection(selected.name, csv)
        ? ""
        : "This browser could not save the collection for reloads in this tab.";
    }
    importStatus.textContent = `Imported ${selected.name}`;
    el("export-status").textContent = "";
    render();
    el("collection").hidden = false;
  } catch (error) {
    if (run !== importId) return;
    importStatus.classList.add("warning");
    importStatus.textContent = `Could not ${restoring ? "restore" : "import"} ${selected.name}. ${error.message || "Try opening the file again."}`
      + (collection ? " Your previous collection is still loaded." : "");
    retryImport.hidden = false;
  }
}

file.addEventListener("change", () => {
  const selected = file.files[0];
  if (!selected) return;
  file.value = "";
  void importCollection(selected);
});

retryImport.addEventListener("click", () => {
  if (retrySource) void importCollection(retrySource.selected, retrySource.restoring);
});

function download(bytes, suffix, type) {
  const url = URL.createObjectURL(new Blob(Array.isArray(bytes) ? bytes : [bytes], {type}));
  const anchor = node("a");
  anchor.href = url;
  anchor.download = filename + suffix;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const exportsByFormat = {
  txt: ["text/plain;charset=utf-8", exportText],
  md: ["text/markdown;charset=utf-8", exportMarkdown],
  tsv: ["text/tab-separated-values;charset=utf-8", exportTsv],
  html: ["text/html;charset=utf-8", exportHtml],
  json: ["application/json", JSON.stringify],
  jsonl: ["application/x-ndjson", exportJsonl],
  sqlite: ["application/vnd.sqlite3", async current => exportSQLite(await loadSQLite(), current)],
};
const exportFormat = el("export-format");
const downloadCollection = el("download-collection");
const exportStatus = el("export-status");

exportFormat.addEventListener("change", () => { exportStatus.textContent = ""; });
downloadCollection.addEventListener("click", async () => {
  if (!collection) return;
  const current = collection;
  const extension = exportFormat.value;
  const [type, serialize] = exportsByFormat[extension];
  downloadCollection.disabled = true;
  exportFormat.disabled = true;
  exportStatus.textContent = `Preparing .${extension} export…`;
  try {
    const bytes = await serialize(current);
    if (current !== collection) return;
    download(bytes, "." + extension, type);
    exportStatus.textContent = `.${extension} export ready.`;
  } catch {
    if (current === collection) exportStatus.textContent = `Could not export .${extension}. Try again.`;
  } finally {
    downloadCollection.disabled = false;
    exportFormat.disabled = false;
  }
});
el("filter").addEventListener("input", () => { page = 0; render(); });
el("collection-filters").addEventListener("change", () => { page = 0; render(); });
el("sort-order").addEventListener("change", () => { page = 0; render(); });
el("reset-filters").addEventListener("click", () => { resetFilters(); render(); });
el("previous").addEventListener("click", () => { page--; render(); });
el("next").addEventListener("click", () => { page++; render(); });

clearCollection.addEventListener("click", () => {
  importId++;
  collection = undefined;
  retrySource = undefined;
  groups = [];
  cards = undefined;
  el("cards").replaceChildren();
  el("collection").hidden = true;
  retryImport.hidden = true;
  clearCollection.hidden = true;
  file.value = "";
  file.focus();
  importStatus.classList.remove("warning");
  importStatus.textContent = "Collection cleared.";
  sessionStatus.textContent = removeSavedCollection()
    ? ""
    : "This browser could not clear the saved copy for this tab.";
});

try {
  const saved = sessionStorage.getItem(sessionKey);
  if (saved) {
    const {name, csv} = JSON.parse(saved);
    if (typeof name !== "string" || typeof csv !== "string") throw new Error("Invalid saved collection.");
    void importCollection({name, text: () => csv}, true);
  }
} catch {
  removeSavedCollection();
}
