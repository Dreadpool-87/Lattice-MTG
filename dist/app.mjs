import {search} from "./search.mjs";
import {showPrintingPanel} from "./printing-panel.mjs";
import {readGzipJson} from "./printings.mjs";

const el = id => document.getElementById(id);
const detail = el("detail");
const escape = value => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
const nf = new Intl.NumberFormat("en-US");
const pageSize = 10;
const shards = new Map();
const tokenCards = new Map();
let catalog, byId = new Map(), matches = [], oracle, selected, card, face, page = 0;
let searchRequest = 0, cardRequest = 0;

async function read(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}

function loadCatalog() {
  catalog ??= Promise.all([read("/data/index.json"), readGzipJson("/data/tokens.json.gz")]).then(([rows, tokens]) => {
    const start = rows.reduce((max, row) => Math.max(max, row[0]), -1) + 1;
    const tokenRows = tokens.map((token, offset) => {
      const id = start + offset;
      tokenCards.set(id, token);
      const types = [...new Set(token.faces.map(face => face.type.split(" — ")[0]).filter(Boolean))];
      const alias = token.layout === "emblem" ? "emblem" : "token";
      return [id, token.name, token.oracleId, types, alias];
    });
    const index = [...rows, ...tokenRows];
    byId = new Map(index.map(row => [row[0], row]));
    return index;
  }).catch(error => {
    catalog = undefined;
    throw error;
  });
  return catalog;
}

function showWorkspace(visible) {
  el("workspace").hidden = !visible;
  el("start").hidden = visible;
}

function shareUrl() {
  const params = new URLSearchParams();
  const query = el("query").value.trim();
  if (query) {
    params.set("q", query);
    if (el("scope").value === "oracle") params.set("scope", "oracle");
  }
  if (selected !== undefined) params.set("card", byId.get(selected)[2]);
  history.replaceState({}, "", location.pathname + (params.size ? "?" + params : ""));
}

function renderResults() {
  const total = matches.length;
  el("status").textContent = `${nf.format(total)} ${total===1?"result":"results"}`;
  el("results").innerHTML = matches.slice(page*pageSize,(page+1)*pageSize).map(([id,name,oid,types]) =>
    `<li><button type="button" class="result" data-card="${id}" aria-current="${id===selected}"><strong>${escape(name)}</strong><small>${escape(types.join(" / "))} · ${escape(oid.slice(0,8))}</small></button></li>`
  ).join("") || '<li class="empty">No cards found.</li>';
  const count = Math.ceil(total/pageSize);
  el("paging").hidden = count<=1;
  el("page").textContent = `${page+1} / ${count}`;
  el("prev").disabled = !page;
  el("next").disabled = page+1>=count;
}

async function find({updateUrl = true} = {}) {
  const run = ++searchRequest;
  const query = el("query").value.trim();
  const scope = el("scope").value;
  ++cardRequest;
  selected = undefined;
  detail.hidden = true;
  showWorkspace(Boolean(query));
  if (!query) {
    if (updateUrl) shareUrl();
    return;
  }
  el("results").replaceChildren();
  el("paging").hidden = true;
  el("status").textContent = "Searching…";
  try {
    const rows = await loadCatalog();
    if (scope === "oracle") {
      oracle ??= read("/data/oracle.json").then(rows => {
        const tokenText = Array.from(tokenCards, ([id, token]) => [id, token.faces.map(face => face.oracleText ?? "").join(" ")]);
        return new Map([...rows, ...tokenText]);
      }).catch(error => {
        oracle = undefined;
        throw error;
      });
    }
    const text = scope === "oracle" ? await oracle : undefined;
    if (run !== searchRequest) return;
    matches = search(rows, query, text);
    page = 0;
    renderResults();
    if (updateUrl) shareUrl();
  } catch {
    if (run === searchRequest) el("status").textContent = "Could not load the catalog. Try searching again.";
  }
}

const tags = list => list.map(value=>`<span class="tag">${escape(value)}</span>`).join("");

function renderLegality(snapshot) {
  const variants = snapshot.legalityVariants ?? [snapshot.legality ?? {}];
  return variants.map((group, index) => {
    const labels = Object.entries(group).flatMap(([status, formats]) =>
      formats.map(format => format + " · " + status.replaceAll("_", " ")));
    const heading = variants.length > 1 ? "<p>Source legality variant " + (index+1) + "</p>" : "";
    return heading + (labels.length ? '<div class="tags">'+tags(labels)+'</div>'
      : '<p class="hint">No format status reported by this snapshot.</p>');
  }).join("");
}

function renderCard() {
  const f = card.faces[face];
  const mana = f.cost.map(cost=>{const ch=cost.slice(1,-1);return `<span class="${escape(ch)}">${escape(ch)}</span>`;}).join("");
  const links = f.edge.filter(edge=>edge.kind==="curated");
  const observations = f.edge.filter(edge=>edge.kind!=="curated");
  const attributes = f.faceManaValue === null ? [] : [`Mana value (face) ${f.faceManaValue}`];
  if (f.power!==null) attributes.push(`${escape(f.power)}/${escape(f.toughness)}`);
  if (f.loyalty!==null) attributes.push(`Loyalty ${escape(f.loyalty)}`);
  if (f.defense!==null) attributes.push(`Defense ${escape(f.defense)}`);
  detail.innerHTML = `<header class="hero"><div class="herobar"><span class="layout">${escape(card.layout)}</span><button class="copy" data-copy>Copy JSON</button></div><h2>${escape(card.name)}</h2><p class="oid">Oracle-ID · ${escape(card.oracleId)}</p></header>
    <div class="body">
    <div class="facebuttons" aria-label="Card view">
      <button type="button" data-view="rules" aria-pressed="true">Card details</button>
      <button type="button" data-view="printings" aria-pressed="false">Printings</button>
    </div>
    <section data-card-rules aria-label="Card details">
    ${card.faces.length>1 ? `<div class="facebuttons" aria-label="Card faces">${card.faces.map((entry,i)=>`<button data-face="${i}" aria-pressed="${i===face}">${escape(entry.name)}</button>`).join("")}</div>` : ""}
    <article class="face"><div class="facedata"><h3>${escape(f.type)}</h3><div class="mana" aria-label="Mana cost">${mana}</div></div>
    <div class="rules">${f.text.map(line=>`<p>${escape(line)}</p>`).join("")}</div>${f.keywords.length ? `<details><summary>Source labels</summary><div class="tags">${tags(f.keywords)}</div></details>` : ""}<p class="hint">${attributes.join(" · ")}</p></article>
    <section class="block"><h3>Interactions</h3>${links.map(({target,note})=>`<div class="rel"><button data-related="${target.card}" data-position="${target.face}">${escape(target.name)}</button><p class="hint">${escape(note)}</p></div>`).join("") || '<p class="inline-empty">No curated links for this face.</p>'}
    ${observations.length ? `<details class="block"><summary>Heuristic tags (${observations.length})</summary><p class="hint">Unverified text matches. Check the Oracle text.</p><div class="tags">${tags(observations.map(e=>e.kind+" · "+e.target))}</div></details>` : ""}</section>
    <details class="block"><summary>Set codes (${card.setCodes.length})</summary><div class="tags">${tags(card.setCodes.map(code=>code.toUpperCase()))}</div></details>
    ${card.isToken ? '<p class="hint">Tokens and emblems are tracked separately from deck inventory.</p>' :
      `<details class="block"><summary>Format legality in this snapshot</summary>${renderLegality(card.snapshotLegality)}<p class="hint">Formats absent from the source status lists are unreported.</p></details>`}</section>
    <section data-printing-panel aria-label="Printings" aria-live="polite" hidden></section></div>`;
}

async function openCard(id, position=0, {move = false, updateUrl = true} = {}) {
  if (!byId.has(id)) return;
  const run = ++cardRequest;
  selected = id;
  renderResults();
  if (updateUrl) shareUrl();
  detail.hidden = false;
  detail.innerHTML = '<p class="empty">Loading card…</p>';
  try {
    const token = tokenCards.get(id);
    if (token) {
      card = {...token, faces: token.faces.map(entry => ({
        ...entry, cost: entry.manaCost?.match(/\{[^{}]+\}/g) ?? [],
        text: entry.oracleText?.split("\n") ?? [], faceManaValue: entry.catalogFaceManaValue ?? null,
        edge: [], keywords: [], power: entry.power ?? null, toughness: entry.toughness ?? null,
        loyalty: entry.loyalty ?? null, defense: entry.defense ?? null,
      }))};
    } else {
      const bucket = Math.floor(id/128);
      if (!shards.has(bucket)) {
        shards.set(bucket, read(`/data/cards-${bucket}.json`).catch(error => { shards.delete(bucket); throw error; }));
      }
      const items = await shards.get(bucket);
      if (run !== cardRequest) return;
      card = items[id];
    }
    face = position;
    renderCard();
    if (move && matchMedia("(max-width:760px)").matches) detail.focus();
  } catch {
    if (run===cardRequest) detail.innerHTML = '<p class="empty">Could not load the card. Select it again to retry.</p>';
  }
}

el("search").addEventListener("submit", event=>{event.preventDefault();find();});
el("scope").addEventListener("change", () => {
  if (el("query").value.trim()) find();
});
el("results").addEventListener("click", event=>{
  const button = event.target.closest("[data-card]");
  if (button) openCard(Number(button.dataset.card),0,{move: true});
});
el("prev").addEventListener("click",()=>{page--;renderResults();});
el("next").addEventListener("click",()=>{page++;renderResults();});
detail.addEventListener("click",async event=>{
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.view) {
    const printings = button.dataset.view === "printings";
    const panel = detail.querySelector("[data-printing-panel]");
    detail.querySelector("[data-card-rules]").hidden = printings;
    panel.hidden = !printings;
    for (const tab of detail.querySelectorAll("[data-view]")) {
      tab.setAttribute("aria-pressed", String(tab === button));
    }
    if (printings && !panel.dataset.loaded) await showPrintingPanel(panel, card.oracleId, card.isToken ? card.setCodes : null);
  } else if (button.dataset.face !== undefined) {
    face = Number(button.dataset.face);
    renderCard();
    detail.querySelector("[aria-pressed=true]")?.focus();
  } else if (button.dataset.related !== undefined) {
    openCard(Number(button.dataset.related),Number(button.dataset.position),{move: true});
  } else if (button.hasAttribute("data-copy")) {
    const json = JSON.stringify(card,null,2);
    try {
      await navigator.clipboard.writeText(json);
      button.textContent = "Copied";
    } catch {
      const output = document.createElement("textarea");
      output.setAttribute("aria-label","Card JSON");
      output.readOnly = true;
      output.style.cssText = "width:100%;min-height:12rem";
      output.value = json;
      detail.querySelector(".body").prepend(output);
      output.select();
    }
  }
});

const params = new URLSearchParams(location.search);
const initialQuery = params.get("q")?.trim();
const initialCard = params.get("card");
el("query").value = initialQuery ?? "";
el("scope").value = params.get("scope") === "oracle" ? "oracle" : "name";
const initialSearch = initialQuery ? find({updateUrl: false}) : undefined;
const initialRequest = searchRequest;
await initialSearch;
if (initialCard && initialRequest === searchRequest) {
  const run = initialRequest;
  showWorkspace(true);
  try {
    const rows = await loadCatalog();
    if (run === searchRequest) {
      const entry = rows.find(row => row[2] === initialCard);
      if (entry) {
        if (!initialQuery) matches = [entry];
        await openCard(entry[0], 0, {updateUrl: false});
      } else if (!initialQuery) {
        el("status").textContent = "This Oracle ID was not found.";
      }
    }
  } catch {
    if (run === searchRequest) el("status").textContent = "Could not load the catalog. Try searching again.";
  }
}
