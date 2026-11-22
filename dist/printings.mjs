export const printingStates = {
  verified: "Verified",
  mismatch: "Mismatch",
  unknown: "Not in snapshot",
  unavailable: "Check unavailable",
  not_provided: "No printing ID",
};

export const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const root = "/data/printings/";
export const nameKey = name => name.normalize("NFC").replace(/[’‘]/g, "'").trim().replace(/\s+/g, " ").toLowerCase();
let meta;
const oracleShards = new Map();
const setShards = new Map();
const idSetShards = new Map();

export async function readGzipJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  let data;
  try {
    const response = await fetch(url, {signal: controller.signal});
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}).`);
    data = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The card data download timed out. Please retry.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (data[0] !== 31 || data[1] !== 139) return JSON.parse(new TextDecoder().decode(data));
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Your browser cannot unpack this file. Try a current browser.");
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).json();
}

function sourceInfo() {
  meta ??= readGzipJson(root + "meta.json").catch(error => { meta = undefined; throw error; });
  return meta;
}

function unpack(row, setNames) {
  const [printingId, oracleId, setCode, collectorNumber, language, printedName, finishes, token, multiverseId, variants] = row;
  return {printingId, oracleId, setCode, collectorNumber, language, printedName,
    setName: setNames[setCode] ?? "", finishes: finishes ? finishes.split(", ") : [], token: Boolean(token),
    multiverseId: multiverseId ?? undefined, ...(variants && {variants: variants.split(",")})};
}

function readOracleShard(prefix) {
  if (!oracleShards.has(prefix)) {
    oracleShards.set(prefix, readGzipJson(root + `oracle-${prefix}.json.gz`).catch(error => {
      oracleShards.delete(prefix);
      throw error;
    }));
  }
  return oracleShards.get(prefix);
}

export async function loadCardPrintings(oracleId, tokenSets) {
  const key = oracleId.toLowerCase();
  if (!uuid.test(key)) return [];
  const records = tokenSets ? Promise.all(tokenSets.map(readSetShard)).then(groups => groups.flat())
    : readOracleShard(key.slice(0, 2));
  const [info, rows] = await Promise.all([sourceInfo(), records]);
  return rows.filter(row => row[1] === key).map(row => unpack(row, info.setNames));
}

export function makePrintingIndex(info, rows) {
  const byId = new Map();
  const byPosition = new Map();
  for (const row of rows) {
    const printing = unpack(row, info.setNames);
    if (!byId.has(printing.printingId)) byId.set(printing.printingId, []);
    byId.get(printing.printingId).push(printing);
    const position = positionKey(printing.setCode, printing.collectorNumber);
    if (!byPosition.has(position)) byPosition.set(position, []);
    byPosition.get(position).push(printing);
  }
  return {snapshot: info.snapshot, source: info.source, variantsVersion: info.variantsVersion, byId, byPosition};
}

const positionKey = (set, number) => set.toUpperCase() + "/" + number.toLowerCase();

function readSetShard(code) {
  if (!setShards.has(code)) {
    setShards.set(code, readGzipJson(root + `set-${code.toLowerCase()}.json.gz`).catch(error => {
      setShards.delete(code);
      throw error;
    }));
  }
  return setShards.get(code);
}

function readIdSetShard(prefix) {
  if (!idSetShards.has(prefix)) {
    idSetShards.set(prefix, readGzipJson(root + `id-set-${prefix}.json.gz`)
      .then(rows => new Map(rows)).catch(error => {
        idSetShards.delete(prefix);
        throw error;
      }));
  }
  return idSetShards.get(prefix);
}

export async function loadPrintingIndex(items) {
  const info = await sourceInfo();
  if (!info.setShards) return makePrintingIndex(info, await readGzipJson(root + "all.json.gz"));
  const available = new Set(info.setShards);
  const requested = new Set(items.filter(item => item.printingId || item.collectorNumber)
    .map(item => item.setCode.toUpperCase()).filter(code => available.has(code)));
  const groups = await Promise.all(Array.from(requested, readSetShard));
  const found = new Set(groups.flatMap(rows => rows.map(row => row[0])));
  const missing = new Set(items.map(item => item.printingId).filter(id => uuid.test(id) && !found.has(id)));
  if (missing.size) {
    if (!info.idSetShards) throw new Error("The printing ID index is unavailable. Please reload and retry.");
    const prefixes = new Set(Array.from(missing, id => id[0]).filter(prefix => info.idSetShards.includes(prefix)));
    const routes = new Map(await Promise.all(Array.from(prefixes, async prefix => [prefix, await readIdSetShard(prefix)])));
    const extra = new Set();
    for (const id of missing) {
      const code = routes.get(id[0])?.get(id);
      if (code && !requested.has(code)) extra.add(code);
    }
    groups.push(...await Promise.all(Array.from(extra, readSetShard)));
  }
  return makePrintingIndex(info, groups.flat());
}

export function verifyPrinting(item, index, matchesCardName) {
  const hasPosition = item.setCode && item.collectorNumber;
  if (!item.printingId && !hasPosition) return {status: "not_provided"};
  if (!index) return {status: "unavailable"};
  const records = item.printingId ? index.byId.get(item.printingId.toLowerCase())
    : index.byPosition?.get(positionKey(item.setCode, item.collectorNumber));
  if (!records) return {status: "unknown"};
  const languages = {
    english: "en", japanese: "ja", german: "de", spanish: "es", french: "fr", italian: "it",
    portuguese: "pt", korean: "ko", russian: "ru", "chinese simplified": "zhs", "chinese traditional": "zht",
  };
  const statedLanguage = nameKey(item.language ?? "");
  const language = languages[statedLanguage] ?? (/^[a-z]{2,3}$/.test(statedLanguage) ? statedLanguage : null);
  const checked = records.map(record => {
    const conflicts = [];
    if (item.setCode && record.setCode.toUpperCase() !== item.setCode.toUpperCase()) conflicts.push("set");
    if (item.collectorNumber && record.collectorNumber.toLowerCase() !== item.collectorNumber.toLowerCase()) {
      conflicts.push("collector number");
    }
    if (item.oracleId && item.oracleId !== record.oracleId) conflicts.push("Oracle ID");
    if (language && record.language !== language) conflicts.push("language");
    if (item.token && !record.token) conflicts.push("token type");
    const display = nameKey(item.name);
    const printed = nameKey(record.printedName);
    if (!matchesCardName(record.oracleId) && display !== printed &&
        !(record.token && [printed + " token", printed + " emblem"].includes(display))) {
      conflicts.push("card name");
    }
    return {record, conflicts};
  });
  const verified = checked.filter(entry => entry.conflicts.length === 0);
  if (!item.printingId && new Set(verified.map(({record}) => record.printingId)).size > 1) {
    return {status: "unknown", matches: verified};
  }
  return {status: verified.length ? "verified" : "mismatch", matches: verified.length ? verified : checked};
}

export const scryfallUrl = printingId =>
  uuid.test(printingId) ? "https://scryfall.com/card/" + printingId.toLowerCase() : null;

export function gathererPrintingUrl(multiverseId) {
  if (!Number.isSafeInteger(multiverseId) || multiverseId <= 0) return null;
  return "https://gatherer.wizards.com/Pages/Card/Details.aspx?multiverseid=" + multiverseId;
}

export const gathererSearchUrl = name =>
  "https://gatherer.wizards.com/Pages/Search/Default.aspx?" + new URLSearchParams({name});
