"""Apply shared site navigation and adapt links to the GitHub Pages base path."""
import re
import sys
from hashlib import sha256
from pathlib import Path

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


if __name__ == "__main__":
    prepare(sys.argv[1])
