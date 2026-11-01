#!/usr/bin/env python3
"""Genera audios de mayor calidad con ElevenLabs y los guarda en audio-premium/.

Los archivos se llaman igual que los de scripts/generate_audio.py (hash de las líneas
"voz|texto"), así que la web no cambia: al publicar, generate_audio.py copia cada MP3 de
audio-premium/ encima del generado con la voz gratuita. Si un texto cambia, su hash cambia
y vuelve a usarse la voz gratuita hasta que se regenere aquí.

Modelos por categoría («opción intermedia»):
  - Eleven v4        → audios del examen (Hören, modelos del Sprechen) y ejercicios de escuchar/dictado
  - Eleven v4 Turbo  → frases de la lección y vocabulario (palabra y ejemplo)

Uso (la clave NUNCA se guarda en el repositorio):
  ELEVENLABS_API_KEY=sk_... python scripts/generate_elevenlabs.py --level a1 --dry-run
  ELEVENLABS_API_KEY=sk_... python scripts/generate_elevenlabs.py --level a1
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_audio import CONTENT, PAUSE_MS, audio_key, tts_text  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "audio-premium"

# Voces estándar de ElevenLabs (multilingües), con el idioma fijado en alemán.
VOICES = {
    "f1": "EXAVITQu4vr4xnSDxMaL",  # Sarah
    "f2": "FGY2WhTYpPnrIDTdsKH5",  # Laura
    "m1": "JBFqnCBsd6RMkjVDRZzb",  # George
    "m2": "onwK4e9ZLuTAKqWW03F9",  # Daniel
}
VOICES.update({"ch-f": VOICES["f2"], "at-f": VOICES["f1"], "ch-m": VOICES["m2"], "at-m": VOICES["m1"]})
MODEL_LONG = "eleven_v4"
MODEL_SHORT = "eleven_v4_turbo"
# Nombres de letras del abecedario: mejor con la voz actual (ElevenLabs no siempre los lee como letra).
SKIP_SHORT = re.compile(r"^[A-Za-zÄÖÜäöüß]{1,7}$")


def collect_level(level: str) -> dict[str, tuple[list[dict], str]]:
    """{clave: (líneas, modelo)} para un nivel. Si una clave sale en varias categorías, gana v4."""
    found: dict[str, tuple[list[dict], str]] = {}

    def add(lines, model):
        if not lines:
            return
        k = audio_key(lines)
        if k in found and found[k][1] == MODEL_LONG:
            return
        found[k] = (lines, model)

    for md in sorted((CONTENT / level).glob("*/leccion.md")):
        for t in re.findall(r"\[\[de:(.+?)\]\]", md.read_text(encoding="utf-8")):
            text = t.split("::")[0]
            if not SKIP_SHORT.match(text.strip()):
                add([{"v": "f1", "t": text}], MODEL_SHORT)
    for tp in sorted((CONTENT / level).glob("*/topic.json")):
        topic = json.loads(tp.read_text(encoding="utf-8"))
        for v in topic.get("vocab", []):
            add([{"v": "f1", "t": v["de"]}], MODEL_SHORT)
            if v.get("ex"):
                add([{"v": "m1", "t": v["ex"]}], MODEL_SHORT)
        for ex in topic.get("exercises", []):
            if ex["type"] == "match":
                for left, _ in ex["pairs"]:
                    add([{"v": "f1", "t": left}], MODEL_SHORT)
            for it in ex.get("items", []):
                if it.get("audio"):
                    add(it["audio"], MODEL_LONG)
        exam = topic.get("exam", {})
        for teil in exam.get("hoeren", {}).values():
            for it in teil:
                add(it["audio"], MODEL_LONG)
        for teil in exam.get("sprechen", {}).values():
            for it in teil:
                if it.get("model"):
                    add(it["model"], MODEL_LONG)
                if it.get("question") and it.get("answer"):
                    add([{"v": "f2", "t": it["question"]}, {"v": "m1", "t": it["answer"]}], MODEL_LONG)
                if it.get("title") and it.get("question"):
                    add([{"v": "f2", "t": it["question"]}], MODEL_LONG)
    return found


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def tts(text: str, voice: str, model: str, key: str) -> tuple[bytes, int]:
    body = json.dumps({"text": text, "model_id": model, "language_code": "de"}).encode()
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICES.get(voice, VOICES['f1'])}?output_format=mp3_44100_64"
    for attempt in range(6):
        req = urllib.request.Request(url, data=body, headers={"xi-api-key": key, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read(), int(r.headers.get("character-cost", 0) or 0)
        except urllib.error.HTTPError as e:
            msg = e.read()[:300].decode("utf-8", "replace")
            if e.code in (429, 500, 502, 503) and attempt < 5:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {e.code}: {msg}") from None
        except urllib.error.URLError:
            if attempt < 5:
                time.sleep(2 * (attempt + 1))
                continue
            raise


def render(key_hash: str, lines: list[dict], model: str, api_key: str) -> int:
    cost = 0
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        parts = []
        for i, line in enumerate(lines):
            data, c = tts(tts_text(line["t"]), line["v"], model, api_key)
            cost += c
            raw = tmp / f"raw{i}.mp3"
            raw.write_bytes(data)
            wav = tmp / f"p{i}.wav"
            ffmpeg("-i", str(raw), "-ar", "24000", "-ac", "1", str(wav))
            parts.append(wav)
        sil = tmp / "sil.wav"
        ffmpeg("-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", f"{PAUSE_MS / 1000}", str(sil))
        seq = []
        for i, p in enumerate(parts):
            if i:
                seq.append(sil)
            seq.append(p)
        listing = tmp / "list.txt"
        listing.write_text("".join(f"file '{p}'\n" for p in seq), encoding="utf-8")
        out_tmp = tmp / "out.mp3"
        ffmpeg("-f", "concat", "-safe", "0", "-i", str(listing), "-ar", "24000", "-ac", "1", "-b:a", "64k", str(out_tmp))
        (OUT / f"{key_hash}.mp3").write_bytes(out_tmp.read_bytes())
    return cost


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--level", default="a1")
    ap.add_argument("--dry-run", action="store_true", help="solo cuenta caracteres")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()

    OUT.mkdir(exist_ok=True)
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    wanted = collect_level(args.level)
    todo = [(k, l, m) for k, (l, m) in wanted.items() if not (OUT / f"{k}.mp3").exists()]
    if args.limit:
        todo = todo[: args.limit]
    chars = {MODEL_LONG: 0, MODEL_SHORT: 0}
    for _, lines, m in todo:
        chars[m] += sum(len(tts_text(l["t"])) for l in lines)
    print(f"{len(wanted)} audios del nivel {args.level} · {len(todo)} por generar · caracteres: {chars}")
    if args.dry_run:
        return
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        sys.exit("Falta la variable de entorno ELEVENLABS_API_KEY")

    total_cost = failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(render, k, l, m, api_key): (k, l, m) for k, l, m in todo}
        for n, f in enumerate(as_completed(futs), 1):
            k, l, m = futs[f]
            try:
                c = f.result()
                total_cost += c
                manifest[k] = m
                if n % 25 == 0 or n == len(todo):
                    print(f"  [{n}/{len(todo)}] créditos gastados: {total_cost}", flush=True)
                    manifest_path.write_text(json.dumps(manifest, indent=0, sort_keys=True))
            except Exception as e:
                failed += 1
                print(f"  ✗ {k} ({l[0]['t'][:40]!r}): {e}", file=sys.stderr, flush=True)
                if "quota" in str(e).lower() or "401" in str(e):
                    pool.shutdown(cancel_futures=True)
                    break
    manifest_path.write_text(json.dumps(manifest, indent=0, sort_keys=True))
    print(f"Hecho. Créditos gastados: {total_cost} · fallos: {failed}")


if __name__ == "__main__":
    main()
