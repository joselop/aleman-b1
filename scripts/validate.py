#!/usr/bin/env python3
"""Comprueba que el contenido del curso es coherente antes de publicarlo.

  python scripts/validate.py            # errores -> código de salida 1
  python scripts/validate.py --strict   # los avisos también cuentan como error

Qué revisa:
  - Cada tema marcado "ready" en curriculum.json tiene topic.json y leccion.md.
  - Los ejercicios tienen respuestas válidas (índices dentro de rango, huecos, frases construibles…).
  - El banco de examen tiene al menos tantas preguntas como pide el examen del tema.
  - Las voces usadas existen y no hay vocabulario duplicado.
  - Opcional: si existe content/<nivel>/wortliste.txt (una palabra por línea, sacada de la
    Wortliste oficial del Goethe), informa de qué palabras aún no aparecen en ningún tema.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
VOICES = {"f1", "f2", "m1", "m2", "ch-f", "ch-m", "at-f", "at-m"}
# Tareas largas (un texto o audio con varias preguntas): basta con un ítem de reserva.
BIG_KINDS = {"read_mc", "read_match", "listen_match", "listen_yn", "speak_topic", "speak_plan", "write_free", "form", "read_tf", "speak_intro"}
EX_TYPES = {"mc", "listen", "match", "gap", "order", "dictation", "write"}

errors: list[str] = []
warnings: list[str] = []


def err(where, msg):
    errors.append(f"✗ {where}: {msg}")


def warn(where, msg):
    warnings.append(f"! {where}: {msg}")


def check_audio(where, lines):
    if not isinstance(lines, list) or not lines:
        return err(where, "audio vacío o mal formado")
    for l in lines:
        if l.get("v") not in VOICES:
            err(where, f"voz desconocida {l.get('v')!r}")
        if not str(l.get("t", "")).strip():
            err(where, "línea de audio sin texto")


def check_mc(where, it):
    opts = it.get("options", [])
    if len(opts) < 2:
        err(where, "menos de 2 opciones")
    if not isinstance(it.get("answer"), int) or not 0 <= it["answer"] < len(opts):
        err(where, f"answer fuera de rango: {it.get('answer')}")
    if len(set(opts)) != len(opts):
        err(where, "opciones repetidas")


def join_words(words):
    return re.sub(r"\s+([,.!?])", r"\1", " ".join(words))


def check_topic(lvl, tid, fmt):
    base = CONTENT / lvl / tid
    tp, md = base / "topic.json", base / "leccion.md"
    if not tp.exists():
        return err(f"{lvl}/{tid}", "falta topic.json")
    if not md.exists():
        err(f"{lvl}/{tid}", "falta leccion.md")
    else:
        text = md.read_text(encoding="utf-8")
        if text.count("[[") != text.count("]]"):
            err(f"{lvl}/{tid}/leccion.md", "corchetes [[ ]] desparejados")
    try:
        topic = json.loads(tp.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return err(f"{lvl}/{tid}/topic.json", f"JSON inválido: {e}")
    W = f"{lvl}/{tid}"
    if topic.get("id") != f"{lvl}-{tid}":
        err(W, f"id debería ser {lvl}-{tid}")
    for k in ("title", "goals", "vocab", "exercises", "exam"):
        if k not in topic:
            err(W, f"falta la clave {k}")

    seen = set()
    for i, v in enumerate(topic.get("vocab", [])):
        for k in ("de", "es", "cat"):
            if not v.get(k):
                err(f"{W} vocab[{i}]", f"falta {k}")
        if v.get("de") in seen:
            err(f"{W} vocab[{i}]", f"duplicado {v['de']!r}")
        seen.add(v.get("de"))

    ids = set()
    for ex in topic.get("exercises", []):
        E = f"{W} {ex.get('id')}"
        if ex.get("id") in ids:
            err(E, "id de ejercicio repetido")
        ids.add(ex.get("id"))
        t = ex.get("type")
        if t not in EX_TYPES:
            err(E, f"tipo desconocido {t!r}")
            continue
        if t == "match":
            rights = [p[1] for p in ex.get("pairs", [])]
            if len(set(rights)) != len(rights):
                err(E, "traducciones repetidas en match")
            continue
        for j, it in enumerate(ex.get("items", [])):
            I = f"{E}[{j}]"
            if t in ("mc", "listen"):
                check_mc(I, it)
                if t == "listen":
                    check_audio(I, it.get("audio"))
            elif t == "gap":
                if not re.search(r"\[\[.+?\]\]", it.get("text", "")):
                    err(I, "hueco sin [[respuesta]]")
            elif t == "order":
                tokens = lambda s: sorted(re.findall(r"[\wäöüÄÖÜß']+|[,.!?]", s.lower()))
                for a in it.get("answers", []):
                    if tokens(a) != tokens(" ".join(it["words"])):
                        err(I, f"la respuesta {a!r} usa palabras distintas de las fichas")
            elif t == "dictation":
                check_audio(I, it.get("audio"))
                if not it.get("answers"):
                    err(I, "sin answers")
            elif t == "write":
                if not it.get("answers"):
                    err(I, "sin answers")

    exam = topic.get("exam", {})
    for m in fmt.get("modules", []):
        for teil in m.get("teile", []):
            kind = teil.get("kind")
            if not kind:
                continue
            bank = exam.get(m["key"], {}).get(teil["key"], [])
            T = f"{W} exam.{m['key']}.{teil['key']}"
            if len(bank) < teil.get("n_tema", 0):
                err(T, f"el banco tiene {len(bank)} y el examen del tema pide {teil['n_tema']}")
            elif len(bank) < teil.get("n_tema", 0) + (1 if kind in BIG_KINDS else 2):
                warn(T, f"banco pequeño ({len(bank)}): los reintentos se repetirán mucho")
            for j, it in enumerate(bank):
                I = f"{T}[{j}]"
                if kind == "listen_mc":
                    check_mc(I, it)
                    check_audio(I, it.get("audio"))
                elif kind == "listen_tf":
                    check_audio(I, it.get("audio"))
                    if not isinstance(it.get("answer"), bool) or not it.get("statement"):
                        err(I, "necesita statement y answer true/false")
                elif kind == "read_tf":
                    if not it.get("text") or not it.get("statements"):
                        err(I, "necesita text y statements")
                    for s in it.get("statements", []):
                        if not isinstance(s.get("answer"), bool):
                            err(I, f"answer no booleano en {s.get('s')!r}")
                elif kind == "read_ab":
                    if it.get("answer") not in ("a", "b") or not it.get("a") or not it.get("b"):
                        err(I, "necesita a, b y answer 'a'/'b'")
                elif kind == "form":
                    for f in it.get("fields", []):
                        if not f.get("given") and not f.get("answers"):
                            err(I, f"campo {f.get('label')!r} sin given ni answers")
                elif kind == "write_free":
                    for k in ("task", "points", "model"):
                        if not it.get(k):
                            err(I, f"falta {k}")
                elif kind == "speak_intro":
                    check_audio(I, it.get("model"))
                elif kind == "speak_cards":
                    for k in ("word", "question", "answer"):
                        if not it.get(k):
                            err(I, f"falta {k}")
                elif kind == "read_mc":
                    if not it.get("questions"):
                        err(I, "read_mc necesita questions")
                    for qi, qq in enumerate(it.get("questions", [])):
                        check_mc(f"{I}.q{qi}", qq)
                elif kind == "read_match":
                    keys = {a.get("key") for a in it.get("ads", [])}
                    answers = [x.get("answer") for x in it.get("items", [])]
                    if not keys or not answers:
                        err(I, "read_match necesita ads e items")
                    for a in answers:
                        if a not in keys | {"x"}:
                            err(I, f"respuesta {a!r} no es ningún anuncio")
                    used = [a for a in answers if a != "x"]
                    if len(used) != len(set(used)):
                        err(I, "dos situaciones apuntan al mismo anuncio")
                    if "x" not in answers:
                        warn(I, "ninguna situación tiene X (en el examen real hay una)")
                elif kind == "listen_match":
                    check_audio(I, it.get("audio"))
                    n = len(it.get("options", []))
                    for x in it.get("items", []):
                        if not isinstance(x.get("answer"), int) or not 0 <= x["answer"] < n:
                            err(I, f"answer fuera de rango en {x.get('q')!r}")
                elif kind == "listen_yn":
                    check_audio(I, it.get("audio"))
                    for x in it.get("statements", []):
                        if not isinstance(x.get("answer"), bool):
                            err(I, f"answer no booleano en {x.get('s')!r}")
                elif kind == "speak_topic":
                    check_audio(I, it.get("model"))
                    if len(it.get("prompts", [])) != 4 or not it.get("question"):
                        err(I, "speak_topic necesita question y 4 prompts")
                elif kind == "speak_plan":
                    check_audio(I, it.get("model"))
                    if not it.get("mine") or not it.get("partner") or not it.get("task"):
                        err(I, "speak_plan necesita task, mine y partner")
    return topic


def wordlist_coverage(lvl, topics):
    wl = CONTENT / lvl / "wortliste.txt"
    if not wl.exists():
        return
    haystack = " ".join(
        " ".join([v["de"], v.get("pl", ""), v.get("ex", "")]) for tp in topics for v in tp.get("vocab", [])
    ).lower()
    words = [w.strip() for w in wl.read_text(encoding="utf-8").splitlines() if w.strip() and not w.startswith("#")]
    missing = [w for w in words if w.lower() not in haystack]
    pct = 100 * (len(words) - len(missing)) / max(1, len(words))
    print(f"Cobertura de la Wortliste {lvl.upper()}: {pct:.0f}% ({len(words) - len(missing)}/{len(words)})")
    if missing:
        (CONTENT / lvl / "wortliste_pendiente.txt").write_text("\n".join(missing), encoding="utf-8")
        print(f"  Pendientes guardadas en content/{lvl}/wortliste_pendiente.txt")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()
    cur = json.loads((CONTENT / "curriculum.json").read_text(encoding="utf-8"))
    n = 0
    for lvl in cur["levels"]:
        fmt = cur["examFormats"].get(lvl["id"], {})
        topics = []
        for t in lvl["topics"]:
            if t["status"] == "ready":
                n += 1
                tp = check_topic(lvl["id"], t["id"], fmt)
                if tp:
                    topics.append(tp)
        wordlist_coverage(lvl["id"], topics)
    print(f"Temas revisados: {n}")
    for w in warnings:
        print(w)
    for e in errors:
        print(e)
    if errors or (args.strict and warnings):
        sys.exit(1)
    print("Todo correcto ✓")
    import bundle  # regenera assets/content-bundle.js para poder abrir index.html con doble clic
    bundle.main()


if __name__ == "__main__":
    main()
