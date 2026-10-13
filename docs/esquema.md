# Esquema del contenido

Todo el curso vive en `content/`. La web no tiene nada escrito a mano: lee estos archivos.

```
content/
  curriculum.json          niveles, lista de temas (status "ready" | "planned") y formato de examen
  a1/
    t01/
      leccion.md           teoría en Markdown
      topic.json           vocabulario, ejercicios y banco de examen
    wortliste.txt          (opcional) Wortliste oficial, una palabra por línea
```

Para publicar un tema nuevo: crea su carpeta, cambia su `status` a `"ready"` en `curriculum.json` y ejecuta `python scripts/validate.py`.

## leccion.md

Markdown normal (títulos `##`/`###`, tablas, listas, `> citas`, `**negrita**`, `*cursiva*`, `~~tachado~~`).
Extensión propia: `[[de:Guten Tag!::¡Buenos días!]]` muestra la frase con un botón de audio y la traducción debajo (la parte tras `::` es opcional y no se lee en el audio).

## topic.json

```jsonc
{
  "id": "a1-t01", "level": "a1", "topic": "t01",
  "title": "…", "title_de": "…",
  "goals": ["…"],
  "vocab": [
    { "de": "der Name", "pl": "die Namen", "es": "el nombre", "cat": "Persona",
      "forms": "(solo verbos) ich heiße, du heißt…", "ex": "Mein Name ist Ana.", "ex_es": "Me llamo Ana." }
  ],
  "exercises": [ /* ver tipos abajo */ ],
  "exam": { "hoeren": { "t1": [], "t2": [] }, "lesen": {}, "schreiben": {}, "sprechen": {} }
}
```

### Audio

Cualquier campo `audio` es una lista de líneas: `[{ "v": "f1", "t": "Hallo!" }, { "v": "m1", "t": "Hallo!" }]`.
Voces: `f1`, `f2`, `m1`, `m2` (alemán de Alemania) y `ch-f`, `ch-m`, `at-f`, `at-m` (Suiza, Austria).
El archivo MP3 se llama como el hash FNV-1a de las líneas, así que nunca hay que poner ids a mano.

### Tipos de ejercicio (`exercises[]`)

| type | Campos de cada ítem |
|---|---|
| `mc` | `q`, `options[]`, `answer` (índice), `explain?` |
| `listen` | igual que `mc` + `audio` |
| `match` | (sin items) `pairs: [["alemán", "español"], …]` |
| `gap` | `text` con huecos `[[respuesta/alternativa]]`, `note?` |
| `order` | `words[]` (fichas; la puntuación final se añade sola), `answers[]` |
| `dictation` | `audio`, `answers[]` |
| `write` | `prompt` (en español), `answers[]` (todas las variantes válidas) |

Las respuestas escritas se comparan ignorando espacios de más y la puntuación final. Si solo fallan las mayúsculas se marca como «casi».

### Tipos de pregunta de examen (`kind` en `curriculum.json → examFormats`)

| kind | Campos |
|---|---|
| `listen_mc` | `q`, `options[3]`, `answer`, `audio` |
| `listen_tf` | `statement`, `answer` (true/false), `audio` |
| `read_tf` | `text`, `sign?` (se muestra como cartel), `statements: [{ s, answer }]` |
| `read_ab` | `situation`, `a`, `b`, `answer` ("a"/"b") |
| `form` | `context`, `title`, `fields: [{ label, given? , answers? }]` |
| `write_free` | `task`, `points[]`, `register`, `model` |
| `speak_intro` | `keywords[]`, `extra`, `model` (audio) |
| `speak_cards` | `theme`, `word`, `question`, `answer` |
| `read_mc` | `title?`, `intro?`, `text`, `questions: [{ q, options[3], answer }]` |
| `listen_mc_multi` | igual que `read_mc` pero con `audio` (y normalmente `intro` en vez de `text`) |
| `read_match` | `ads: [{ key: "a"…, text }]`, `items: [{ situation, answer: "a"… / "x" }]` (cada anuncio se usa como mucho una vez; una situación lleva "x") |
| `listen_match` | `intro`, `options[]`, `audio`, `items: [{ q, answer: índice en options }]` |
| `listen_yn` | `intro`, `audio`, `statements: [{ s, answer }]` (el Teil puede definir `labels`, p. ej. ["Richtig", "Falsch"]) |
| `speak_topic` | `theme`, `question`, `prompts[4]`, `model` |
| `speak_plan` | `task`, `mine[]`, `partner[]`, `model` (diálogo) |
| `read_yn` (B1) | `title?`, `intro?`, `question` (¿está a favor de…?), `comments: [{ name, text, answer }]` |
| `listen_pair` (B1) | `audio`, `statement`, `tf` (true/false), `q`, `options[3]`, `answer` |
| `speak_points` (B1) | `task`, `points[4]`, `model` (diálogo) |
| `speak_present` (B1) | `title`, `slides?` (si no, las 5 diapositivas estándar), `model` (presentación), `question`, `answer` (Teil 3) |

`write_free` admite además `quote` (texto al que se reacciona, p. ej. un comentario de foro) y `words` (extensión orientativa).

`n_tema` y `n_global` indican cuántos ítems de ese Teil entran en cada examen. El examen global reparte las preguntas por turnos entre todos los temas «ready» del nivel hasta el actual.

Los formatos de A1, A2 y B1 están definidos en `curriculum.json`.
