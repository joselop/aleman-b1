#!/usr/bin/env python3
"""Genera los MP3 de todos los audios del curso.

Recorre content/**/topic.json y content/**/leccion.md, reúne cada fragmento que la web
puede reproducir y lo sintetiza. El nombre de archivo es un hash (FNV-1a) de las líneas
"voz|texto", el mismo que calcula assets/app.js, así que:
  - si cambias un texto, se genera un audio nuevo automáticamente;
  - lo que ya existe no se vuelve a generar;
  - si un audio falta, la web usa la voz del navegador.

Uso:
  pip install edge-tts            # motor por defecto (voces neuronales de Microsoft, gratis)
  python scripts/generate_audio.py
  python scripts/generate_audio.py --engine piper --piper-dir ~/piper-voices   # 100 % local
  python scripts/generate_audio.py --engine sine  # tonos de prueba, sin red (para tests)

Necesita ffmpeg en el PATH.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
AUDIO = ROOT / "audio"
PAUSE_MS = 450

# Voces lógicas usadas en el contenido -> voz concreta de cada motor.
EDGE_VOICES = {
    "f1": "de-DE-KatjaNeural",
    "f2": "de-DE-AmalaNeural",
    "m1": "de-DE-ConradNeural",
    "m2": "de-DE-KillianNeural",
    "ch-f": "de-CH-LeniNeural",
    "ch-m": "de-CH-JanNeural",
    "at-f": "de-AT-IngridNeural",
    "at-m": "de-AT-JonasNeural",
}
# Modelos de Piper (https://huggingface.co/rhasspy/piper-voices). Thorsten y Kerstin son CC0.
PIPER_VOICES = {
    "f1": ("de_DE-kerstin-low", None),
    "f2": ("de_DE-eva_k-x_low", None),
    "m1": ("de_DE-thorsten-high", None),
    "m2": ("de_DE-thorsten_emotional-medium", 0),
}


# --------------------------------------------------------------------------- utilidades
def fnv1a(text: str) -> str:
    h = 0x811C9DC5
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def audio_key(lines: list[dict]) -> str:
    return fnv1a("\n".join(f"{l['v']}|{l['t']}" for l in lines))


def tts_text(t: str) -> str:
    t = re.sub(r"\s*/\s*", ", ", t)
    return t.replace("…", "").strip()


# --------------------------------------------------------------------------- recolección
def collect() -> dict[str, list[dict]]:
    """Devuelve {clave: líneas} con todos los audios que la web puede pedir."""
    found: dict[str, list[dict]] = {}

    def add(lines):
        if lines:
            found[audio_key(lines)] = lines

    for md in sorted(CONTENT.glob("*/*/leccion.md")):
        for t in re.findall(r"\[\[de:(.+?)\]\]", md.read_text(encoding="utf-8")):
            add([{"v": "f1", "t": t}])

    for tp in sorted(CONTENT.glob("*/*/topic.json")):
        topic = json.loads(tp.read_text(encoding="utf-8"))
        for v in topic.get("vocab", []):
            add([{"v": "f1", "t": v["de"]}])
            if v.get("ex"):
                add([{"v": "m1", "t": v["ex"]}])
        for ex in topic.get("exercises", []):
            if ex["type"] == "match":
                for left, _ in ex["pairs"]:
                    add([{"v": "f1", "t": left}])
            for it in ex.get("items", []):
                if it.get("audio"):
                    add(it["audio"])
        exam = topic.get("exam", {})
        for teil in exam.get("hoeren", {}).values():
            for it in teil:
                add(it["audio"])
        sp = exam.get("sprechen", {})
        for it in sp.get("t1", []):
            add(it.get("model"))
        for it in sp.get("t2", []):
            add([{"v": "f2", "t": it["question"]}, {"v": "m1", "t": it["answer"]}])
    return found


# --------------------------------------------------------------------------- motores
def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


async def synth_edge(text: str, voice: str, out: Path):
    import edge_tts  # pip install edge-tts

    await edge_tts.Communicate(text, EDGE_VOICES.get(voice, EDGE_VOICES["f1"]), rate="-5%").save(str(out))


def synth_piper(text: str, voice: str, out: Path, piper_dir: Path):
    model, speaker = PIPER_VOICES.get(voice, PIPER_VOICES["f1"])
    onnx = piper_dir / f"{model}.onnx"
    if not onnx.exists():
        raise FileNotFoundError(f"Falta el modelo {onnx}. Descárgalo de huggingface.co/rhasspy/piper-voices")
    cmd = ["piper", "--model", str(onnx), "--output_file", str(out)]
    if speaker is not None:
        cmd += ["--speaker", str(speaker)]
    subprocess.run(cmd, input=text.encode("utf-8"), check=True, capture_output=True)


def synth_sine(text: str, voice: str, out: Path):
    freq = {"f1": 660, "f2": 740, "m1": 330, "m2": 280}.get(voice, 500)
    dur = max(0.4, len(text) * 0.03)
    ffmpeg("-f", "lavfi", "-i", f"sine=frequency={freq}:duration={dur:.2f}", str(out))


async def render(lines: list[dict], out: Path, engine: str, piper_dir: Path | None):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        parts = []
        for i, line in enumerate(lines):
            raw = tmp / f"raw{i}.{'mp3' if engine == 'edge' else 'wav'}"
            text = tts_text(line["t"])
            if engine == "edge":
                await synth_edge(text, line["v"], raw)
            elif engine == "piper":
                synth_piper(text, line["v"], raw, piper_dir)
            else:
                synth_sine(text, line["v"], raw)
            wav = tmp / f"p{i}.wav"
            ffmpeg("-i", str(raw), "-ar", "24000", "-ac", "1", str(wav))
            parts.append(wav)
        silence = tmp / "sil.wav"
        ffmpeg("-f", "lavfi", "-i", f"anullsrc=r=24000:cl=mono", "-t", f"{PAUSE_MS / 1000}", str(silence))
        listing = tmp / "list.txt"
        seq = []
        for i, p in enumerate(parts):
            if i:
                seq.append(silence)
            seq.append(p)
        listing.write_text("".join(f"file '{p}'\n" for p in seq), encoding="utf-8")
        ffmpeg("-f", "concat", "-safe", "0", "-i", str(listing), "-ar", "24000", "-ac", "1", "-b:a", "64k", str(out))


# --------------------------------------------------------------------------- main
async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--engine", choices=["edge", "piper", "sine"], default="edge")
    ap.add_argument("--piper-dir", type=Path, default=Path.home() / "piper-voices")
    ap.add_argument("--prune", action="store_true", help="borra MP3 que ya no usa ningún contenido")
    ap.add_argument("--limit", type=int, default=0, help="genera como mucho N audios (para probar)")
    args = ap.parse_args()

    if not shutil.which("ffmpeg"):
        sys.exit("Necesitas ffmpeg instalado.")
    AUDIO.mkdir(exist_ok=True)
    wanted = collect()
    missing = [k for k in wanted if not (AUDIO / f"{k}.mp3").exists()]
    if args.limit:
        missing = missing[: args.limit]
    print(f"{len(wanted)} audios en el contenido · {len(missing)} por generar ({args.engine})")

    failed = 0
    for n, key in enumerate(missing, 1):
        try:
            await render(wanted[key], AUDIO / f"{key}.mp3", args.engine, args.piper_dir)
            print(f"  [{n}/{len(missing)}] {key} · {wanted[key][0]['t'][:50]}")
        except Exception as e:  # sigue con el resto; la web usará la voz del navegador
            failed += 1
            print(f"  ✗ {key}: {e}", file=sys.stderr)

    if args.prune:
        for f in AUDIO.glob("*.mp3"):
            if f.stem not in wanted:
                f.unlink()
    present = sorted(k for k in wanted if (AUDIO / f"{k}.mp3").exists())
    (AUDIO / "manifest.json").write_text(json.dumps({"engine": args.engine, "files": present}, indent=0), encoding="utf-8")
    print(f"Manifest: {len(present)}/{len(wanted)} audios disponibles. Fallos: {failed}")


if __name__ == "__main__":
    asyncio.run(main())
