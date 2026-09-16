#!/usr/bin/env python3
"""
Build dist/lab_results_to_diggs.html: the sources in src/ inlined into one
self-contained HTML file that runs offline from disk.

    python3 build.py           # write dist/lab_results_to_diggs.html
    python3 build.py --check   # exit 1 if dist/ is out of date (used by CI)

Standard library only. The version stamp is the first 12 hex digits of a
SHA-256 over the source files, computed the same way as the copy hosted at
https://diggs.geosetta.org/?tool=lab_diggs_builder, so a downloaded page can
tell when a newer version exists.
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
DIST = ROOT / "dist" / "lab_results_to_diggs.html"
SOURCES = ("index.html", "styles.css", "core.js", "ui.js", "templates.json")
REPO_URL = "https://github.com/DIGGSml/lab_results_to_diggs"


def version() -> str:
    digest = hashlib.sha256()
    for name in SOURCES:
        digest.update(name.encode())
        digest.update((SRC / name).read_bytes())
    return digest.hexdigest()[:12]


def _inline_script(js: str) -> str:
    # An inline <script> ends at the first "</script", whatever the context.
    if "</script" in js.lower():
        raise ValueError("inline script contains '</script'")
    return js


def build() -> str:
    read = lambda name: (SRC / name).read_text(encoding="utf-8")  # noqa: E731
    html = read("index.html")
    html = html.replace("    /* APP_CSS */", read("styles.css"), 1)
    html = html.replace("// CORE_JS", _inline_script(read("core.js")), 1)
    html = html.replace("// UI_JS", _inline_script(read("ui.js")), 1)
    templates = json.loads(read("templates.json"))
    html = html.replace("/*__TEMPLATES_JSON__*/null",
                        _inline_script(json.dumps(templates, ensure_ascii=True, separators=(",", ":"))), 1)
    html = html.replace("<!-- DISCLAIMER_COMMENT -->",
                        f"<!-- Lab Results to DIGGS. MIT License. Source: {REPO_URL} -->", 1)
    html = html.replace(
        "<!-- DISCLAIMER_FOOTER -->",
        "Open-source software under the MIT License, provided as-is. You are responsible for "
        f'checking the files it produces. <a href="{REPO_URL}" target="_blank" rel="noopener">Source code</a>.', 1)
    html = html.replace("__TOOL_VERSION__", version())
    for marker in ("/* APP_CSS */", "// CORE_JS", "// UI_JS", "__TEMPLATES_JSON__",
                   "DISCLAIMER_COMMENT", "DISCLAIMER_FOOTER", "__TOOL_VERSION__"):
        if marker in html:
            raise ValueError(f"placeholder left in output: {marker}")
    return html


def main() -> int:
    html = build()
    if "--check" in sys.argv[1:]:
        current = DIST.read_text(encoding="utf-8") if DIST.exists() else ""
        if current != html:
            print(f"{DIST.relative_to(ROOT)} is out of date: run python3 build.py and commit it")
            return 1
        print(f"{DIST.relative_to(ROOT)} is up to date (version {version()})")
        return 0
    DIST.parent.mkdir(exist_ok=True)
    DIST.write_text(html, encoding="utf-8")
    print(f"wrote {DIST.relative_to(ROOT)} ({len(html.encode()) // 1024} KB, version {version()})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
