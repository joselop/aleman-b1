"""Prueba de extremo a extremo de la transcripción (Whisper en el navegador).

Genera una frase en alemán con edge-tts, la pasa por la función transcribe() de la web
con Chromium y comprueba que el texto reconocido se parece al original.
Se ejecuta en GitHub Actions (workflow «Probar transcripción»).
"""
import asyncio, difflib, functools, http.server, os, sys, threading
import edge_tts
from playwright.async_api import async_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SENTENCE = "Ich heiße José und wohne seit einem Jahr in Zürich. Am Wochenende gehe ich gern wandern."

async def main():
    await edge_tts.Communicate(SENTENCE, "de-DE-ConradNeural").save(os.path.join(ROOT, "_test.mp3"))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8765), functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        pg.on("console", lambda m: print("::notice::[console] " + m.text.replace("\n", " ")[:300]))
        pg.on("pageerror", lambda e: print("::error::[pageerror] " + str(e)[:500]))
        await pg.goto("http://127.0.0.1:8765/#/ajustes")
        await pg.wait_for_function("window.__dsfs && window.__dsfs.transcribe")
        for model in ["base", "tiny"]:
            await pg.evaluate(f"localStorage.setItem('dsfs:settings', JSON.stringify({{asr: '{model}'}}))")
            text = await pg.evaluate("""async () => {
                const blob = await (await fetch('/_test.mp3')).blob();
                return await window.__dsfs.transcribe(blob, (m) => console.log(m));
            }""")
            ratio = difflib.SequenceMatcher(None, SENTENCE.lower(), text.lower()).ratio()
            print(f"::notice::MODEL {model}: {text!r}  similitud={ratio:.2f}")
            if model == "base" and ratio < 0.7:
                sys.exit("La transcripción no se parece a la frase original")
        await b.close()

try:
    asyncio.run(main())
except SystemExit:
    raise
except Exception as e:  # que el error se vea como anotación en GitHub
    import traceback
    print("::error::" + traceback.format_exc().replace("\n", " | ")[-1500:])
    sys.exit(1)
