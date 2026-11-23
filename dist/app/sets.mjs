const index = document.querySelector("#app-set-index");
const detail = document.querySelector("#app-set-detail");
const query = document.querySelector("#app-set-query");
const count = document.querySelector("#app-set-count");
const params = new URLSearchParams(location.search);
const catalog = new Map();
const groups = [...index.querySelectorAll("h2 + ul")].map(list => ({
  list,
  heading: list.previousElementSibling,
  entries: [...list.querySelectorAll("li")].map(item => {
    const link = item.querySelector("a");
    const url = new URL(link.href);
    const code = url.pathname.split("/").filter(Boolean).at(-1);
    catalog.set(code, url);
    return {item, link, code, text: link.textContent.toLowerCase()};
  }),
}));

function route(set = "") {
  const next = new URL(location.pathname, location.origin);
  const filter = query.value.trim();
  if (filter) next.searchParams.set("q", filter);
  if (set) next.searchParams.set("set", set);
  return next.href;
}

function filterSets() {
  const term = query.value.trim().toLowerCase();
  const exactCode = catalog.has(term);
  let matches = 0;
  for (const {list, heading, entries} of groups) {
    let visible = 0;
    for (const {item, link, code, text} of entries) {
      item.hidden = exactCode ? code !== term : !text.includes(term);
      if (!item.hidden) {
        visible++;
        link.href = route(code);
      }
    }
    heading.hidden = list.hidden = visible === 0;
    matches += visible;
  }
  count.textContent = matches === 1 ? "1 set" : `${matches.toLocaleString("en")} sets`;
}

async function showSet(code) {
  const canonical = catalog.get(code);
  const back = document.createElement("a");
  back.href = route();
  back.textContent = "Back to sets";
  const content = document.createElement("div");
  content.textContent = "Loading set…";
  content.setAttribute("role", "status");
  detail.append(back, content);
  index.hidden = true;
  detail.hidden = false;
  try {
    if (!canonical) throw new Error("Set not found.");
    const response = await fetch(canonical);
    if (!response.ok) throw new Error("Could not load this set.");
    const page = new DOMParser().parseFromString(await response.text(), "text/html");
    const source = page.querySelector("main");
    const title = source?.querySelector("h1");
    if (!title) throw new Error("Could not read this set.");
    while (source.firstElementChild !== title) source.firstElementChild.remove();
    for (const link of source.querySelectorAll("a[href]")) {
      const url = new URL(link.getAttribute("href"), canonical);
      const related = url.pathname.split("/").filter(Boolean).at(-1);
      link.href = catalog.get(related)?.href === url.href ? route(related) : url.href;
    }
    document.title = page.title;
    content.removeAttribute("role");
    content.replaceChildren(...source.childNodes);
  } catch {
    content.textContent = canonical ? "Could not load this set. " : "Set not found.";
    if (canonical) {
      const fallback = document.createElement("a");
      fallback.href = canonical.href;
      fallback.textContent = "Open in the full catalog";
      content.append(fallback);
    }
  }
}

query.value = params.get("q") ?? "";
if (params.has("set")) {
  void showSet(params.get("set").toLowerCase());
} else {
  query.closest(".app-set-search").hidden = false;
  filterSets();
  query.addEventListener("input", () => {
    filterSets();
    history.replaceState(null, "", route());
  });
}
