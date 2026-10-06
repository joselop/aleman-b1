#!/usr/bin/env python3
"""Rellena las plantillas de scripts/prompts/ con los datos de un tema.

  python scripts/build_prompt.py a1 t02             # prompt para generar el tema
  python scripts/build_prompt.py a1 t02 --review    # prompt para revisarlo
  python scripts/build_prompt.py a1 t02 > prompt.txt

Incluye automáticamente el vocabulario de los temas anteriores, el formato de examen del
nivel (con un ejemplo de cada tipo de pregunta) y, si existe, la parte pendiente de la
Wortliste oficial (content/<nivel>/wortliste.txt; ver validate.py).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
N_VOCAB = {"a1": "40–60", "a2": "50–80", "b1": "70–100"}


def example_for(kind: str, module: str, teil: str, level: str = "*") -> str:
    """Busca un ítem de ejemplo de ese tipo en cualquier tema existente."""
    for tp in sorted(CONTENT.glob(f"{level}/*/topic.json")):
        bank = json.loads(tp.read_text(encoding="utf-8")).get("exam", {}).get(module, {}).get(teil, [])
        if bank:
            return json.dumps(bank[0], ensure_ascii=False)
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("level")
    ap.add_argument("topic")
    ap.add_argument("--review", action="store_true")
    a = ap.parse_args()

    cur = json.loads((CONTENT / "curriculum.json").read_text(encoding="utf-8"))
    lvl = next(l for l in cur["levels"] if l["id"] == a.level)
    idx = next(i for i, t in enumerate(lvl["topics"]) if t["id"] == a.topic)
    t = lvl["topics"][idx]
    before, after = lvl["topics"][:idx], lvl["topics"][idx + 1 :]

    # Vocabulario de todos los temas anteriores (niveles previos incluidos).
    vocab = []
    for L in cur["levels"]:
        for T in L["topics"]:
            if L["id"] == a.level and T["id"] == a.topic:
                break
            f = CONTENT / L["id"] / T["id"] / "topic.json"
            if f.exists():
                vocab += [v["de"] for v in json.loads(f.read_text(encoding="utf-8"))["vocab"]]
        else:
            continue
        break

    fmt_lines = []
    fmt = cur["examFormats"].get(a.level, {})
    for m in fmt.get("modules", []):
        for teil in m["teile"]:
            if teil.get("kind"):
                ex = example_for(teil["kind"], m["key"], teil["key"], a.level)
                fmt_lines.append(
                    f"- **{m['name']} Teil {teil['key'][1:]}** → `exam.{m['key']}.{teil['key']}`, tipo `{teil['kind']}`"
                    f" (examen del tema: {teil['n_tema']} ítem{'s' if teil['n_tema'] != 1 else ''}). {teil['es']}\n  Ejemplo: `{ex}`"
                )
            else:
                fmt_lines.append(f"- **{m['name']} Teil {teil['key'][1:]}** → `exam.{m['key']}.{teil['key']}`: {teil['es']}")
    if fmt and not any(t.get("kind") for m in fmt["modules"] for t in m["teile"]):
        fmt_lines.append(
            "\nNOTA: la web todavía no tiene tipos de pregunta definidos para este nivel. Usa los tipos existentes "
            "(`listen_mc`, `listen_tf`, `read_tf`, `read_ab`, `form`, `write_free`, `speak_intro`, `speak_cards`) "
            "cuando encajen y describe en un comentario aparte los que haga falta programar."
        )

    wl = ""
    for name in ("wortliste_pendiente.txt", "wortliste.txt"):
        f = CONTENT / a.level / name
        if f.exists():
            words = [w.strip() for w in f.read_text(encoding="utf-8").splitlines() if w.strip() and not w.startswith("#")]
            wl = ("Palabras de la Wortliste oficial que aún no cubre ningún tema. Incluye las que encajen de forma natural "
                  f"con este tema:\n\n{', '.join(words[:400])}")
            break

    values = {
        "EXAMEN": lvl["exam"],
        "NIVEL": a.level,
        "NIVEL_NOMBRE": lvl["name"],
        "TEMA": a.topic,
        "NUMERO": str(idx + 1),
        "TOTAL": str(len(lvl["topics"])),
        "TITULO": t["title"],
        "GRAMATICA": "; ".join(t["grammar"]),
        "TEMAS_PREVIOS": "; ".join(f"{x['title']} ({', '.join(x['grammar'])})" for x in before) or "ninguno",
        "TEMAS_POSTERIORES": "; ".join(f"{x['title']} ({', '.join(x['grammar'])})" for x in after) or "ninguno",
        "VOCAB_PREVIO": ", ".join(vocab) if vocab else "(ninguno: es el primer tema)",
        "WORTLISTE": wl,
        "N_VOCAB": N_VOCAB.get(a.level, "50–80"),
        "FORMATO_EXAMEN": "\n".join(fmt_lines),
    }
    tpl = (ROOT / "scripts" / "prompts" / ("revisar_tema.md" if a.review else "generar_tema.md")).read_text(encoding="utf-8")
    tpl = tpl.split("---", 1)[1] if "---" in tpl else tpl  # quita la nota inicial para humanos
    for k, v in values.items():
        tpl = tpl.replace("{{" + k + "}}", v)
    print(tpl.strip())


if __name__ == "__main__":
    main()
