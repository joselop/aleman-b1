#!/usr/bin/env python3
"""Empaqueta todo content/ en assets/content-bundle.js.

Así la web funciona también abriendo index.html con doble clic (file://), donde el
navegador no deja leer los JSON con fetch. En un servidor (GitHub Pages) la web lee
content/ directamente y este archivo solo es un respaldo.

  python scripts/bundle.py        (validate.py también lo ejecuta al final)
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    data = {}
    for f in sorted((ROOT / "content").rglob("*")):
        rel = f.relative_to(ROOT).as_posix()
        if f.suffix == ".json":
            data[rel] = json.loads(f.read_text(encoding="utf-8"))
        elif f.name == "leccion.md":
            data[rel] = f.read_text(encoding="utf-8")
    manifest = ROOT / "audio" / "manifest.json"
    if manifest.exists():
        data["audio/manifest.json"] = json.loads(manifest.read_text(encoding="utf-8"))
    out = ROOT / "assets" / "content-bundle.js"
    out.write_text(
        "// Generado por scripts/bundle.py — no editar a mano.\nwindow.__CONTENT = "
        + json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(f"Bundle: {len(data)} archivos → assets/content-bundle.js ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
