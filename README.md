# Deutsch Schritt für Schritt

Curso de alemán **de cero al Goethe-Zertifikat B1**, explicado en español y pensado para estudiar solo. Todo el contenido (lecciones, ejercicios, exámenes y audios) se genera con IA y se publica gratis en GitHub Pages.

- **3 bloques**: A1 (12 temas), A2 (11), B1 (12).
- **Cada tema**: lección con audio, vocabulario con repaso espaciado, ~10 ejercicios autocorregidos y **dos exámenes con formato Goethe** (Hören, Lesen, Schreiben, Sprechen):
  - *Examen del tema*: solo lo visto en ese tema.
  - *Examen global*: preguntas de todos los temas del nivel vistos hasta ahora.
  Cada intento saca preguntas distintas del banco.
- **Progreso** guardado en el navegador (exportable desde *Ajustes*).

Estado actual: A1 · Tema 1 completo; el resto del temario está planificado en `content/curriculum.json`.

## Publicarlo en GitHub Pages

1. Crea un repositorio en GitHub y sube esta carpeta:
   ```bash
   git init && git add . && git commit -m "Primer tema"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/aleman-b1.git
   git push -u origin main
   ```
2. En el repositorio: **Settings → Pages → Source: GitHub Actions**.
3. Cada `push` ejecuta `.github/workflows/publicar.yml`, que valida el contenido, genera los audios nuevos con voces neuronales (edge-tts) y publica la web en `https://TU_USUARIO.github.io/aleman-b1/`.

## Verlo en tu ordenador

Abre `index.html` con doble clic. En ese modo la web lee el contenido de `assets/content-bundle.js`, que se regenera solo al ejecutar `python scripts/validate.py` (hazlo cada vez que cambies algo en `content/`).

También puedes servir la carpeta, que es como funciona en GitHub Pages:

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

Sin audios generados, la web usa la voz alemana de tu navegador. Para generar los MP3 en local:

```bash
pip install edge-tts          # necesita también ffmpeg
python scripts/generate_audio.py
```

Alternativa 100 % offline con Piper (voces libres Thorsten/Kerstin): instala `piper-tts`, descarga los modelos de <https://huggingface.co/rhasspy/piper-voices> en `~/piper-voices` y ejecuta `python scripts/generate_audio.py --engine piper`.

## Crear un tema nuevo con IA

1. **Generar**: `python scripts/build_prompt.py a1 t02 > prompt.txt`. El prompt ya incluye el vocabulario de los temas anteriores, la gramática que toca y el formato de examen con ejemplos. Pégalo en Claude y guarda los dos archivos que devuelva en `content/a1/t02/`.
2. **Revisar** en una conversación nueva: `python scripts/build_prompt.py a1 t02 --review` y pega debajo los dos archivos. Aplica las correcciones.
3. **Validar**: `python scripts/validate.py` (respuestas fuera de rango, frases imposibles de construir, bancos de examen pequeños…).
4. En `curriculum.json` cambia el `status` del tema a `"ready"`, prueba en local y haz `push`.

**Cobertura de la Wortliste.** Descarga la Wortliste oficial del nivel desde la web del Goethe-Institut, pásala a texto (una palabra por línea) y guárdala como `content/a1/wortliste.txt`. `validate.py` te dirá qué porcentaje cubre ya el curso y `build_prompt.py` pedirá a la IA que incluya las que faltan.

## Estructura

```
index.html, assets/        la web (HTML + CSS + JS sin dependencias)
content/                   todo el contenido del curso (ver docs/esquema.md)
scripts/validate.py        comprobaciones del contenido (y regenera el bundle)
scripts/bundle.py          empaqueta content/ para abrir la web con doble clic
scripts/generate_audio.py  genera los MP3 (edge-tts, Piper o tonos de prueba)
scripts/build_prompt.py    prepara los prompts de generación y revisión
scripts/prompts/           plantillas de los prompts
audio/                     MP3 generados (no se sube al repo; lo crea GitHub Actions)
```

## Limitaciones conocidas

- **Schreiben (texto libre) y Sprechen** no se corrigen solos: tienes texto modelo, audio modelo, grabadora y autoevaluación. El botón «Copiar para corregir con Claude» prepara un prompt con los criterios del Goethe.
- El contenido lo genera una IA: revisa cada tema con el prompt de revisión y contrasta tu nivel con los **Modellsätze oficiales** gratuitos del Goethe-Institut al final de cada bloque.
- A2 y B1 necesitarán algunos tipos de pregunta nuevos en `assets/app.js` (ver `docs/esquema.md`).
