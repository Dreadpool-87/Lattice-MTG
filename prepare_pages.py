"""Apply shared site navigation and adapt links to the GitHub Pages base path."""
import re
import sys
from hashlib import sha256
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parent / "dist"
ATTR_PATH = re.compile(r'((?:href|src)=")/(?!/)')
CATALOG_LINK = re.compile(r'(href="(?:letter-|p-)[a-z0-9-]+)(?=[#"])')
MODULE_PATH = re.compile(r"""(["'`])/(?=data/|collection/|\?)""")
STYLE_LINK = re.compile(r'(href="[^"?]*/(styles\.css|collection/collection\.css))(?:\?v=[0-9a-f]+)?(?=")')
THEME_SCRIPT = re.compile(r'<script src="[^"?]*/theme\.js(?:\?v=[0-9a-f]+)?"></script>')
COLLECTION_PAGE = re.compile(r'(src="[^"?]*/collection/page\.mjs)(?:\?v=[0-9a-f]+)?(?=")')
COLLECTION_IMPORT = re.compile(r'"\./collection\.mjs(?:\?v=[0-9a-f]+)?"')
EXPLORER_SCRIPT = re.compile(r'(src="[^"?]*/app\.mjs)(?:\?v=[0-9a-f]+)?(?=")')
SEARCH_IMPORT = re.compile(r'"\./search\.mjs(?:\?v=[0-9a-f]+)?"')
FAVICON = '<link rel="icon" type="image/svg+xml" href="/lattice-spark.svg">'
BRAND_LINK = re.compile(r'<a [^>]*class="brand"[^>]*>.*?</a>')
BODY_TAG = re.compile(r"<body(?:\s[^>]*)?>")
CREDITS_LINK = '<a class="site-credits-link" href="/credits/">Credits &amp; Licensing</a>'
LEGACY_HOME_LINK = re.compile(
    r'(<main class="wrap static-catalog">\s*)'
    r'<p><a href="(?:\.\./)+">Lattice MTG</a>(?:( · )|</p>\s*)'
)
ADMIN_LINK = (
    '<a class="admin-link" href="https://lattice-mtg-admin.dreadpool.workers.dev/" '
    'referrerpolicy="no-referrer">Admin</a>'
)
APP_SCREENS = {
    "Search": ("app/", "index.html"),
    "Sets": ("app/sets/", "sets/index.html"),
    "Collection": ("app/collection/", "collection/index.html"),
}


def with_site_header(html, brand, *, show_admin):
    if BRAND_LINK.search(html):
        return BRAND_LINK.sub(lambda _: brand, html, count=1)
    navigation = brand + (ADMIN_LINK if show_admin else "")
    header = (
        '\n<header class="sitebar"><div class="wrap brandrow">'
        f'{navigation}</div></header>\n'
    )
    html = LEGACY_HOME_LINK.sub(
        lambda match: match[1] + ("<p>" if match[2] else ""),
        html,
        count=1,
    )
    return BODY_TAG.sub(lambda match: match[0] + header, html, count=1)


def with_credits_link(html):
    if 'class="site-credits-link"' in html:
        return html
    if "</footer>" in html:
        return html.replace("</footer>", f"<p>{CREDITS_LINK}</p></footer>", 1)
    return html.replace("</body>", f'<footer class="wrap">{CREDITS_LINK}</footer>\n</body>', 1)


def build_web_app(prefix):
    style = ROOT / "app" / "mobile.css"
    version = sha256(style.read_bytes()).hexdigest()[:12]
    sets_version = sha256((ROOT / "app" / "sets.mjs").read_bytes()).hexdigest()[:12]
    install_version = sha256((ROOT / "app" / "install.mjs").read_bytes()).hexdigest()[:12]
    routes_version = sha256((ROOT / "app" / "routes.mjs").read_bytes()).hexdigest()[:12]
    screens = {**APP_SCREENS, "Catalog": ("app/catalog/", "cards/index.html")}
    for screen, (route, source) in screens.items():
        html = (ROOT / source).read_text(encoding="utf-8")
        if screen in {"Sets", "Catalog"}:
            # Resolve source-relative assets and links before moving the page under /app/.
            html = re.sub(
                r'href="(?![/#]|[\w+.-]+:)([^"]+)"',
                lambda match: f'href="{urljoin(prefix + source, match[1])}"',
                html,
            )
        if screen == "Sets":
            html = html.replace('<main class="wrap static-catalog">', '''<main class="wrap static-catalog">
<section id="app-set-index">''', 1)
            html = html.replace("<h1>Browse sets</h1>", '''<h1>Browse sets</h1>
<div class="app-set-search" hidden>
  <label for="app-set-query">Find a set</label>
  <input id="app-set-query" type="search" placeholder="Set name or code">
  <p id="app-set-count" role="status"></p>
</div>''', 1)
            html = html.replace("</main>", '''</section>
<section id="app-set-detail" hidden></section>
</main>''', 1)
            html = html.replace(
                "</head>",
                f'<script type="module" src="{prefix}app/sets.mjs?v={sets_version}"></script>\n</head>',
                1,
            )
        if screen == "Search":
            html = html.replace('action="/"', f'action="{prefix + route}"', 1)
            html = html.replace(f'href="{prefix}collection/"', f'href="{prefix}app/collection/"')
            html = html.replace(f'href="{prefix}cards/"', f'href="{prefix}app/catalog/"')
            html = html.replace("<!-- app-install -->", '''<div id="app-install">
    <button type="button" id="app-install-button" hidden>Install app</button>
    <details id="app-install-help">
      <summary>Install app</summary>
      <p>Android: choose Install app or Add to Home Screen from your browser menu. On iPhone: in Safari, choose Share → Add to Home Screen, then enable Open as Web App when shown.</p>
    </details>
  </div>''', 1)
            html = html.replace(
                "</head>",
                f'<script type="module" src="{prefix}app/install.mjs?v={install_version}"></script>\n</head>',
                1,
            )
        if screen == "Collection":
            html = html.replace(
                "Your collection stays in this tab until you clear it, replace it, or close the tab.",
                "By default, your collection stays in this tab.",
                1,
            )
            html = html.replace('<div class="import-actions">', '''<label class="app-save-collection" hidden>
  <input type="checkbox" id="save-collection-on-device"> Remember collection on this device
</label>
<div class="import-actions">''', 1)
        html = BODY_TAG.sub(
            lambda match: match[0][:-1] + f' data-app-screen="{screen.lower()}">',
            html,
            count=1,
        )
        html = html.replace(
            "</head>",
            f'<link rel="stylesheet" href="{prefix}app/mobile.css?v={version}">\n'
            f'<link rel="manifest" href="{prefix}app/manifest.webmanifest">\n'
            f'<script type="module" src="{prefix}app/routes.mjs?v={routes_version}"></script>\n'
            f'<link rel="apple-touch-icon" href="{prefix}app/icon-192.png?v=web">\n</head>',
            1,
        )
        def nav_link(label, target):
            active = ' aria-current="page"' if screen == label else ""
            return f'<a href="{prefix + target}"{active}>{label}</a>'

        links = "".join(nav_link(label, target) for label, (target, _) in APP_SCREENS.items())
        nav = f'<nav class="app-nav" aria-label="Lattice web app"><div>{links}</div></nav>'
        html = html.replace("</body>", f'{nav}\n</body>', 1)
        destination = ROOT / route / "index.html"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(html, encoding="utf-8")


def prepare(base_path):
    prefix = base_path.rstrip("/") + "/"
    style_versions = {
        path: sha256((ROOT / path).read_bytes()).hexdigest()[:12]
        for path in ("styles.css", "collection/collection.css")
    }
    theme_version = sha256((ROOT / "theme.js").read_bytes()).hexdigest()[:12]
    theme_script = f'<script src="/theme.js?v={theme_version}"></script>'
    collection = ROOT / "collection"
    search_version = sha256((ROOT / "search.mjs").read_bytes()).hexdigest()[:12]

    for module in ("app.mjs", "printings.mjs", "collection/page.mjs"):
        path = ROOT / module
        original = path.read_text(encoding="utf-8")
        javascript = MODULE_PATH.sub(lambda match: match[1] + prefix, original)
        if path.parent == collection:
            version = sha256((collection / "collection.mjs").read_bytes()).hexdigest()[:12]
            javascript = COLLECTION_IMPORT.sub(f'"./collection.mjs?v={version}"', javascript)
        if module == "app.mjs":
            javascript = SEARCH_IMPORT.sub(f'"./search.mjs?v={search_version}"', javascript)
        if javascript != original:
            path.write_text(javascript, encoding="utf-8")
    collection_page_version = sha256((collection / "page.mjs").read_bytes()).hexdigest()[:12]

    explorer_version = sha256((ROOT / "app.mjs").read_bytes()).hexdigest()[:12]
    homepage = ROOT / "index.html"
    home = homepage.read_text(encoding="utf-8")
    brand = BRAND_LINK.search(home).group()
    updates = ROOT / "updates" / "index.html"

    for page in ROOT.rglob("*.html"):
        if page.is_relative_to(ROOT / "app"):
            continue
        original = page.read_text(encoding="utf-8")
        branded = with_site_header(original, brand, show_admin=page == updates)
        if page != ROOT / "credits" / "index.html":
            branded = with_credits_link(branded)
        branded = STYLE_LINK.sub(lambda match: f"{match[1]}?v={style_versions[match[2]]}", branded)
        if page == collection / "index.html":
            branded = COLLECTION_PAGE.sub(lambda match: f"{match[1]}?v={collection_page_version}", branded)
        if page == homepage:
            branded = EXPLORER_SCRIPT.sub(lambda match: f"{match[1]}?v={explorer_version}", branded)
        if THEME_SCRIPT.search(branded):
            branded = THEME_SCRIPT.sub(theme_script, branded, count=1)
        else:
            branded = branded.replace("</head>", theme_script + "\n</head>", 1)
        if 'rel="icon"' not in branded:
            branded = branded.replace("</head>", FAVICON + "\n</head>", 1)
        html = ATTR_PATH.sub(
            lambda match: match[0] if branded.startswith(prefix[1:], match.end())
            else match[1] + prefix,
            branded,
        )
        if page.parent == ROOT / "cards":
            html = CATALOG_LINK.sub(r"\1.html", html)
        if html != original:
            page.write_text(html, encoding="utf-8")
    build_web_app(prefix)


if __name__ == "__main__":
    prepare(sys.argv[1])
