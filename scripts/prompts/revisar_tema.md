# Prompt: revisar un tema generado

> Úsalo en una conversación **nueva** (para que el revisor no sea el mismo que escribió el tema).
> Pega debajo `leccion.md` y `topic.json`, y después ejecuta `python scripts/validate.py`.

---

Eres un profesor nativo de alemán y examinador acreditado del Goethe-Institut. Revisa con ojo crítico el siguiente tema de un curso para hispanohablantes (nivel **{{NIVEL_NOMBRE}}**, tema **{{TITULO}}**, gramática: {{GRAMATICA}}).

Comprueba, en este orden:

1. **Corrección del alemán**: ortografía, género y plural de los sustantivos, conjugaciones, orden de palabras, puntuación. Cualquier frase que un nativo no diría así es un error.
2. **Respuestas**: que cada `answer` sea correcta y única; que no falten variantes válidas en `answers` de `write`/`order`; que las afirmaciones richtig/falsch se puedan decidir con el texto.
3. **Nivel**: marca palabras o estructuras por encima del nivel o de temas posteriores ({{TEMAS_POSTERIORES}}).
4. **Explicaciones en español**: que sean correctas, claras y sin reglas inventadas.
5. **Formato de examen**: que cada Teil se parezca en tipo de texto y dificultad al examen real.

Devuelve:
- Una tabla `| Ubicación | Problema | Corrección |` con todos los fallos (si no hay, dilo).
- Después, los dos archivos completos ya corregidos, cada uno en su bloque de código.

---

LECCIÓN:

```markdown
(pega aquí leccion.md)
```

TOPIC.JSON:

```json
(pega aquí topic.json)
```
