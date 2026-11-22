import {loadCardPrintings, scryfallUrl} from "./printings.mjs";
import {printingVariantLabels} from "./printing-variants.mjs";

function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  if (className) element.className = className;
  return element;
}

function drawPrintings(panel, records) {
  if (!records.length) {
    panel.replaceChildren(node("p", "No printings in this snapshot.", "hint"));
    return;
  }
  records.sort((a, b) => a.setCode.localeCompare(b.setCode) ||
    a.collectorNumber.localeCompare(b.collectorNumber, "en", {numeric: true}) ||
    a.language.localeCompare(b.language));
  const filter = node("input");
  filter.type = "search";
  filter.placeholder = "Filter by set, collector number, or language…";
  filter.setAttribute("aria-label", "Filter printings");
  const label = node("p", "", "hint");
  label.setAttribute("role", "status");
  const list = node("ul", undefined, "printing-list");
  const paging = node("div", undefined, "printing-paging");
  const prev = node("button", "Previous");
  const next = node("button", "Next");
  paging.append(prev, next);
  let offset = 0;
  const pageSize = 20;
  function render() {
    const needle = filter.value.trim().toLowerCase();
    const visible = records.filter(r =>
      [r.setCode, r.setName, r.collectorNumber, "#" + r.collectorNumber, r.language]
        .some(field => field.toLowerCase().includes(needle)));
    list.replaceChildren(...visible.slice(offset, offset + pageSize).map(record => {
      const item = node("li", undefined, "printing-entry");
      const title = node("strong", `${record.setCode} #${record.collectorNumber}${record.setName ? " · " + record.setName : ""}`);
      const variants = (record.variants ?? []).map(variant => printingVariantLabels.get(variant));
      const metadata = [record.printedName, record.language, ...record.finishes, ...variants];
      const link = node("a", "View on Scryfall");
      link.href = scryfallUrl(record.printingId);
      link.target = "_blank";
      link.rel = "noopener";
      item.append(title, node("p", metadata.filter(Boolean).join(" · "), "hint"), link);
      return item;
    }));
    label.textContent = visible.length
      ? `${offset + 1}–${Math.min(offset + pageSize, visible.length)} of ${visible.length} printings`
      : "No matching printings.";
    paging.hidden = visible.length <= pageSize;
    prev.disabled = offset === 0;
    next.disabled = offset + pageSize >= visible.length;
  }
  filter.addEventListener("input", () => { offset = 0; render(); });
  prev.addEventListener("click", () => { offset -= pageSize; render(); });
  next.addEventListener("click", () => { offset += pageSize; render(); });
  panel.replaceChildren(filter, label, list, paging);
  render();
}

export async function showPrintingPanel(panel, oracleId, tokenSets) {
  panel.replaceChildren(node("p", "Loading printings…", "hint"));
  try {
    const records = await loadCardPrintings(oracleId, tokenSets);
    if (panel.isConnected) {
      drawPrintings(panel, records);
      panel.dataset.loaded = "true";
    }
  } catch {
    if (panel.isConnected) panel.replaceChildren(node("p", "Could not load printings. Select Printings to try again.", "hint"));
  }
}
