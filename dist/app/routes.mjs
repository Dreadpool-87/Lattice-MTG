const appRoot = new URL("./", import.meta.url);
const siteRoot = new URL("../", import.meta.url);
const catalogPage = /^(?:cards\/(?:[a-z0-9-]+\.html)?|lookup\/(?:[a-z0-9-]+\/)*(?:[a-z0-9-]+\.html)?|sets\/type-[a-z0-9-]+\.html|updates\/|credits\/)$/;

function appDestination(url) {
  if (url.origin !== siteRoot.origin || !url.pathname.startsWith(siteRoot.pathname)) return url;
  const path = url.pathname.slice(siteRoot.pathname.length);
  const part = path.replace(/index\.html$/, "");
  const set = /^sets\/([a-z0-9]+)\/$/.exec(part);
  let next;
  if (!part || part === "collection/" || part === "sets/") {
    next = new URL(part + url.search + url.hash, appRoot);
  } else if (set) {
    next = new URL("sets/", appRoot);
    next.searchParams.set("set", set[1]);
    next.hash = url.hash;
  } else if (catalogPage.test(part)) {
    next = new URL("catalog/", appRoot);
    if (part !== "cards/") next.searchParams.set("page", part);
    next.hash = url.hash;
  }
  return next ?? url;
}

function routeLinks(root, base) {
  for (const link of root.querySelectorAll("a[href]")) {
    link.href = appDestination(new URL(link.getAttribute("href"), base));
  }
}

async function openCatalogPage(main, path) {
  main.hidden = true;
  const status = document.createElement("p");
  status.className = "wrap";
  status.setAttribute("role", "status");
  status.textContent = "Loading page…";
  main.before(status);
  try {
    if (!catalogPage.test(path)) throw new Error("Page not found.");
    const source = new URL(path, siteRoot);
    const response = await fetch(source);
    if (!response.ok) throw new Error("Page not found.");
    const page = new DOMParser().parseFromString(await response.text(), "text/html");
    const content = page.querySelector("main");
    if (!content) throw new Error("Page content is unavailable.");
    routeLinks(content, source);
    main.replaceChildren(...content.childNodes);
    document.title = page.title;
    status.remove();
    main.hidden = false;
    if (location.hash) {
      document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
    }
  } catch {
    status.textContent = "Could not open this page. ";
    const back = document.createElement("a");
    back.href = new URL("catalog/", appRoot);
    back.textContent = "Back to card catalog";
    status.append(back);
  }
}

// Prepare static links immediately, then handle links rendered by search and collection.
routeLinks(document, location.href);

const searchStateKey = "lattice.web.search.v1";
const searchTab = document.querySelector(".app-nav a");
if (document.body.dataset.appScreen === "search") {
  window.addEventListener("pagehide", () => {
    try {
      const params = new URLSearchParams(location.search);
      for (const key of [...params.keys()]) {
        if (!["q", "card", "scope", "sort"].includes(key)) params.delete(key);
      }
      sessionStorage.setItem(searchStateKey, params.toString());
    } catch {
      // The app still works when tab storage is unavailable.
    }
  });
} else if (searchTab) {
  const restoreSearchLink = () => {
    try {
      const target = new URL(appRoot);
      target.search = sessionStorage.getItem(searchStateKey) ?? "";
      searchTab.href = target.href;
    } catch {
      // The default Search link still works.
    }
  };
  restoreSearchLink();
  window.addEventListener("pageshow", restoreSearchLink);
}

document.addEventListener("click", event => {
  const link = event.target.closest?.("a[href]");
  if (link && !link.hasAttribute("download")) link.href = appDestination(new URL(link.href));
});

const catalog = document.querySelector('[data-app-screen="catalog"] main');
const page = new URLSearchParams(location.search).get("page");
if (catalog && page) void openCatalogPage(catalog, page);
