"""Adapt the static build to the GitHub Pages URL without changing the snapshot."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "dist"
ATTR_PATH = re.compile(r'((?:href|src)=")/(?!/)')
CATALOG_LINK = re.compile(r'(href="(?:letter-|p-)[a-z0-9-]+)(?=[#"])')
MODULE_PATH = re.compile(r"""(["'`])/(?=data/|collection/|\?)""")


def prepare(base_path):
    prefix = base_path.rstrip("/") + "/"

    for page in ROOT.rglob("*.html"):
        original = page.read_text(encoding="utf-8")
        html = ATTR_PATH.sub(
            lambda match: match[0] if original.startswith(prefix[1:], match.end())
            else match[1] + prefix,
            original,
        )
        if page.parent == ROOT / "cards":
            html = CATALOG_LINK.sub(r"\1.html", html)
        if html != original:
            page.write_text(html, encoding="utf-8")

    for module in ("app.mjs", "printings.mjs", "collection/page.mjs"):
        path = ROOT / module
        original = path.read_text(encoding="utf-8")
        javascript = MODULE_PATH.sub(lambda match: match[1] + prefix, original)
        if javascript != original:
            path.write_text(javascript, encoding="utf-8")


if __name__ == "__main__":
    prepare(sys.argv[1])
