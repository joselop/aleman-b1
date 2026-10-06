// Deutsch Schritt für Schritt — motor de la web (sin dependencias, sin build).
// Todo el contenido vive en /content como JSON + Markdown. Ver docs/esquema.md.

(() => {
"use strict";

/* ------------------------------------------------------------------ utils */
const $ = (sel, root = document) => root.querySelector(sel);
const app = () => document.getElementById("app");

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Baraja las opciones de una pregunta de elección múltiple y recoloca el índice correcto.
function shuffleOptions(it) {
  const order = shuffle(it.options.map((_, i) => i));
  return { ...it, options: order.map((i) => it.options[i]), answer: order.indexOf(it.answer) };
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Normaliza respuestas: sin espacios de más, apóstrofos unificados, sin puntuación final.
function norm(s, { keepCase = true } = {}) {
  let t = String(s).replace(/[’`´]/g, "'").replace(/\s+/g, " ").trim();
  t = t.replace(/\s*([,.!?;:])/g, "$1").replace(/[.!?]+$/, "");
  return keepCase ? t : t.toLowerCase();
}
// Devuelve "ok", "case" (bien salvo mayúsculas) o "no".
function compare(input, answers) {
  const a = norm(input);
  if (answers.some((x) => norm(x) === a)) return "ok";
  if (answers.some((x) => norm(x, { keepCase: false }) === a.toLowerCase())) return "case";
  return "no";
}

/* ------------------------------------------------------------------ store */
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("dsfs:" + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("dsfs:" + key, JSON.stringify(value));
    } catch { /* modo privado o almacenamiento lleno */ }
  },
  all() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith("dsfs:")) out[k.slice(5)] = JSON.parse(localStorage.getItem(k));
      }
    } catch { /* ignore */ }
    return out;
  },
};

/* ------------------------------------------------------------------ data */
const cache = {};
// Con doble clic (file://) el navegador no deja usar fetch: se usa assets/content-bundle.js.
const LOCAL = location.protocol === "file:";
function fromBundle(url) {
  const b = window.__CONTENT || {};
  if (url in b) return b[url];
  throw new Error(`No encuentro ${url}. Ejecuta: python scripts/bundle.py`);
}
async function getJSON(url) {
  if (!(url in cache)) {
    cache[url] = LOCAL
      ? Promise.resolve().then(() => fromBundle(url))
      : fetch(url).then((r) => {
          if (!r.ok) throw new Error(`${r.status} ${url}`);
          return r.json();
        }).catch((e) => (window.__CONTENT && url in window.__CONTENT ? window.__CONTENT[url] : Promise.reject(e)));
  }
  return cache[url];
}
async function getText(url) {
  if (LOCAL) return fromBundle(url);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return await r.text();
  } catch (e) {
    if (window.__CONTENT && url in window.__CONTENT) return window.__CONTENT[url];
    throw e;
  }
}
const curriculum = () => getJSON("content/curriculum.json");
const loadTopic = (lvl, tid) => getJSON(`content/${lvl}/${tid}/topic.json`);

/* ------------------------------------------------------------------ audio */
// Clave del audio = FNV-1a (32 bits) de "voz|texto" por línea. Debe coincidir con scripts/generate_audio.py.
function audioKey(lines) {
  const s = lines.map((l) => `${l.v}|${l.t}`).join("\n");
  const bytes = new TextEncoder().encode(s);
  let hsh = 0x811c9dc5;
  for (const b of bytes) {
    hsh ^= b;
    hsh = Math.imul(hsh, 0x01000193) >>> 0;
  }
  return hsh.toString(16).padStart(8, "0");
}
// Texto que se envía al sintetizador (mismo criterio que el script de Python).
const ttsText = (t) => t.replace(/\s*\/\s*/g, ", ").replace(/…/g, "").replace(/\?$/, "?").trim();

let manifest = new Set();
getJSON("audio/manifest.json")
  .then((m) => (manifest = new Set(m.files || [])))
  .catch(() => {});

window.__dsfs = { audioKey: (l) => audioKey(l) }; // útil para depurar

const settings = () => ({ rate: 0.9, ...store.get("settings", {}) });

let deVoices = [];
function refreshVoices() {
  if (!("speechSynthesis" in window)) return;
  deVoices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("de"));
}
if ("speechSynthesis" in window) {
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
}
const FEMALE = /(anna|helena|petra|katja|hedda|amala|marlene|vicki|sandy|shelley|flo|leni|ingrid|seraphina|louisa|female|frau)/i;
const MALE = /(markus|yannick|martin|conrad|stefan|killian|hans|jonas|reed|eddy|rocko|ralf|florian|male|mann)/i;
function voiceFor(v) {
  const fem = deVoices.filter((x) => FEMALE.test(x.name));
  const mal = deVoices.filter((x) => MALE.test(x.name));
  const any = deVoices;
  const pick = (list, i) => (list.length ? list[Math.min(i, list.length - 1)] : null);
  const table = {
    f1: [pick(fem, 0), 1.05], f2: [pick(fem, 1), fem.length > 1 ? 1.0 : 1.25],
    m1: [pick(mal, 0), mal.length ? 1.0 : 0.8], m2: [pick(mal, 1), mal.length > 1 ? 1.0 : 0.65],
  };
  const [voice, pitch] = table[v] || table.f1;
  return { voice: voice || pick(any, 0), pitch };
}

let current = null; // reproducción en curso
function stopAudio() {
  if (current) current.stop();
  current = null;
}
/** Reproduce una lista de líneas {v,t}. Usa el MP3 pregenerado si existe; si no, la voz del navegador. */
function play(lines, { onend } = {}) {
  stopAudio();
  const key = audioKey(lines);
  const rate = settings().rate;
  let stopped = false;
  const finish = () => {
    if (current && current.key === key) current = null;
    if (!stopped && onend) onend();
  };
  if (manifest.has(key)) {
    const audio = new Audio(`audio/${key}.mp3`);
    audio.playbackRate = rate;
    audio.onended = finish;
    audio.onerror = finish;
    audio.play().catch(finish);
    current = { key, stop: () => { stopped = true; audio.pause(); } };
    return current;
  }
  if (!("speechSynthesis" in window)) {
    alert("Tu navegador no tiene síntesis de voz y este audio aún no está generado.");
    finish();
    return null;
  }
  speechSynthesis.cancel();
  let i = 0;
  let timer = null;
  const next = () => {
    if (stopped) return;
    if (i >= lines.length) return finish();
    const line = lines[i++];
    const u = new SpeechSynthesisUtterance(ttsText(line.t));
    const { voice, pitch } = voiceFor(line.v);
    if (voice) u.voice = voice;
    u.lang = voice ? voice.lang : "de-DE";
    u.pitch = pitch;
    u.rate = rate;
    u.onend = () => { timer = setTimeout(next, 450); };
    u.onerror = () => { timer = setTimeout(next, 50); };
    speechSynthesis.speak(u);
  };
  current = { key, stop: () => { stopped = true; clearTimeout(timer); speechSynthesis.cancel(); } };
  next();
  return current;
}
function speakBtn(lines, label = "Escuchar") {
  const b = h("button", { class: "spk", type: "button", title: label, "aria-label": label }, "🔊");
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    b.classList.add("playing");
    play(lines, { onend: () => b.classList.remove("playing") });
    setTimeout(() => b.classList.remove("playing"), 15000);
  });
  return b;
}

/* ------------------------------------------------------------------ markdown */
function inline(text) {
  let s = esc(text);
  // [[de:Texto alemán]] o [[de:Texto alemán::Traducción]]
  s = s.replace(/\[\[de:(.+?)\]\]/g, (_, whole) => {
    const [t, tr] = whole.split("::");
    const raw = t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const de = `<span class="de-line"><button class="spk" type="button" data-say="${esc(raw)}" aria-label="Escuchar">🔊</button><span lang="de">${t}</span></span>`;
    return tr
      ? `<span class="de has-tr">${de}<span class="tr" lang="es">${tr}</span></span>`
      : `<span class="de">${de}</span>`;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");
  s = s.replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>");
  s = s.replace(/`(.+?)`/g, "<code>$1</code>");
  return s;
}
function markdown(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))) {
      const lvl = m[1].length;
      const id = m[2].toLowerCase().normalize("NFD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
      out.push(`<h${Math.max(2, lvl)} id="${id}">${inline(m[2])}</h${Math.max(2, lvl)}>`);
      i++;
    } else if (l.trim().startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++]);
      const head = cells(rows[0]);
      const body = rows.slice(1).filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
      out.push(`<div class="tablewrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
        .map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`);
    } else if (l.startsWith(">")) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${buf.map(inline).join("<br>")}</blockquote>`);
    } else if (/^\s*[-*]\s+/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      out.push(`<ul>${buf.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`);
    } else if (/^\s*\d+\.\s+/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*\d+\.\s+/, ""));
      out.push(`<ol>${buf.map((x) => `<li>${inline(x)}</li>`).join("")}</ol>`);
    } else if (/^---+$/.test(l.trim())) {
      out.push("<hr>");
      i++;
    } else {
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(#|>|\||\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${inline(buf.join(" "))}</p>`);
    }
  }
  return out.join("\n");
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-say]");
  if (!b) return;
  b.classList.add("playing");
  play([{ v: "f1", t: b.dataset.say }], { onend: () => b.classList.remove("playing") });
});

/* ------------------------------------------------------------------ progress */
const exKey = (topicId, exId) => `ex:${topicId}:${exId}`;
function examAttempts(topicId, mode) {
  return store.get(`exam:${topicId}:${mode}`, []);
}
function topicSummary(topic) {
  const done = topic.exercises.filter((e) => store.get(exKey(topic.id, e.id), null) !== null).length;
  const best = (mode) => {
    const a = examAttempts(topic.id, mode);
    return a.length ? Math.max(...a.map((x) => x.total)) : null;
  };
  const s = { done, total: topic.exercises.length, tema: best("tema"), global: best("global") };
  store.set(`sum:${topic.id}`, s);
  return s;
}

/* ------------------------------------------------------------------ SRS (vocabulario) */
const BOX_DAYS = [0, 1, 3, 7, 16, 35];
const today = () => Math.floor(Date.now() / 86400000);
function srsAll() { return store.get("srs", {}); }
function srsAdd(topic) {
  const s = srsAll();
  topic.vocab.forEach((v) => {
    const k = `${topic.id}|${v.de}`;
    if (!s[k]) s[k] = { box: 0, due: today() };
  });
  store.set("srs", s);
}
async function srsDue() {
  const s = srsAll();
  const due = Object.entries(s).filter(([, c]) => c.due <= today());
  const cards = [];
  for (const [k, c] of due) {
    const [tid, de] = k.split("|");
    const [lvl, t] = tid.split("-");
    try {
      const topic = await loadTopic(lvl, t);
      const v = topic.vocab.find((x) => x.de === de);
      if (v) cards.push({ key: k, card: c, v, topic });
    } catch { /* tema eliminado */ }
  }
  return shuffle(cards);
}
function srsGrade(key, ok) {
  const s = srsAll();
  const c = s[key];
  if (!c) return;
  c.box = ok ? Math.min(c.box + 1, BOX_DAYS.length - 1) : 0;
  c.due = today() + (ok ? BOX_DAYS[c.box] : 0);
  store.set("srs", s);
}
async function updateRepasoBadge() {
  const n = Object.values(srsAll()).filter((c) => c.due <= today()).length;
  const a = document.getElementById("nav-repaso");
  if (a) a.innerHTML = n ? `Repaso <span class="badge">${n}</span>` : "Repaso";
}

/* ------------------------------------------------------------------ router */
async function route() {
  stopAudio();
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const root = app();
  root.innerHTML = "";
  try {
    if (!parts.length) await viewHome(root);
    else if (parts[0] === "repaso") await viewRepaso(root);
    else if (parts[0] === "ajustes") viewAjustes(root);
    else if (parts.length === 1) await viewLevel(root, parts[0]);
    else if (parts[2] === "examen") await viewExam(root, parts[0], parts[1], parts[3] || "tema");
    else await viewTopic(root, parts[0], parts[1], parts[2] || "leccion");
  } catch (err) {
    console.error(err);
    root.append(h("div", { class: "card error" }, h("h2", {}, "No se pudo cargar esta página"), h("p", {}, String(err.message || err)),
      h("p", {}, "Si abriste index.html con doble clic, ejecuta python scripts/validate.py para regenerar assets/content-bundle.js."), h("a", { href: "#/" }, "← Volver al inicio")));
  }
  updateRepasoBadge();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", route);

/* ------------------------------------------------------------------ views: home & level */
function scoreChip(v, label) {
  if (v === null || v === undefined) return h("span", { class: "chip muted" }, `${label}: —`);
  return h("span", { class: `chip ${v >= 60 ? "pass" : "fail"}` }, `${label}: ${v}%`);
}

async function viewHome(root) {
  const cur = await curriculum();
  root.append(
    h("section", { class: "hero" },
      h("h1", {}, cur.title),
      h("p", { class: "lead" }, cur.subtitle),
      h("p", { class: "muted" }, "Tres bloques (A1 → A2 → B1). Cada tema tiene lección, vocabulario, ejercicios y dos exámenes con formato Goethe: uno solo del tema y otro de repaso global."))
  );
  const grid = h("div", { class: "levels" });
  for (const lvl of cur.levels) {
    const ready = lvl.topics.filter((t) => t.status === "ready").length;
    grid.append(
      h("a", { class: "level-card", href: `#/${lvl.id}` },
        h("div", { class: "level-name" }, lvl.name),
        h("div", {},
          h("div", { class: "level-exam" }, lvl.exam),
          h("p", {}, lvl.description),
          h("div", { class: "progressbar", title: `${ready} de ${lvl.topics.length} temas disponibles` }, h("span", { style: `width:${(100 * ready) / lvl.topics.length}%` })),
          h("small", { class: "muted" }, `${ready} de ${lvl.topics.length} temas disponibles`)))
    );
  }
  root.append(grid);
}

async function viewLevel(root, lvlId) {
  const cur = await curriculum();
  const lvl = cur.levels.find((l) => l.id === lvlId);
  if (!lvl) throw new Error("Nivel no encontrado");
  root.append(
    h("nav", { class: "crumbs" }, h("a", { href: "#/" }, "Inicio"), " / ", lvl.name),
    h("h1", {}, `${lvl.name} · ${lvl.exam}`),
    h("p", { class: "lead" }, lvl.description),
    h("p", { class: "muted" }, `Vocabulario de referencia: ${lvl.wordlist}.`)
  );
  const list = h("ol", { class: "topics" });
  for (const [i, t] of lvl.topics.entries()) {
    const sum = store.get(`sum:${lvl.id}-${t.id}`, null);
    const ready = t.status === "ready";
    const inner = [
      h("span", { class: "tnum" }, String(i + 1).padStart(2, "0")),
      h("div", { class: "tbody" },
        h("div", { class: "ttitle" }, t.title),
        h("div", { class: "tgram" }, t.grammar.join(" · ")),
        ready && sum ? h("div", { class: "chips" }, h("span", { class: "chip muted" }, `Ejercicios ${sum.done}/${sum.total}`), scoreChip(sum.tema, "Examen tema"), scoreChip(sum.global, "Global")) : null,
        !ready ? h("span", { class: "chip muted" }, "Próximamente") : null)
    ];
    list.append(h("li", { class: ready ? "" : "disabled" }, ready ? h("a", { href: `#/${lvl.id}/${t.id}` }, inner) : h("div", {}, inner)));
  }
  root.append(list);
}

/* ------------------------------------------------------------------ views: topic */
async function viewTopic(root, lvlId, tid, tab) {
  const cur = await curriculum();
  const lvl = cur.levels.find((l) => l.id === lvlId);
  const topic = await loadTopic(lvlId, tid);
  const idx = lvl.topics.findIndex((t) => t.id === tid);
  const sum = topicSummary(topic);
  root.append(
    h("nav", { class: "crumbs" }, h("a", { href: "#/" }, "Inicio"), " / ", h("a", { href: `#/${lvlId}` }, lvl.name), " / ", `Tema ${idx + 1}`),
    h("h1", {}, topic.title),
    h("p", { class: "subtitle", lang: "de" }, topic.title_de)
  );
  const tabs = [["leccion", "Lección"], ["vocabulario", "Vocabulario"], ["ejercicios", `Ejercicios (${sum.done}/${sum.total})`], ["examenes", "Exámenes"]];
  root.append(h("div", { class: "tabs", role: "tablist" }, tabs.map(([k, label]) => h("a", { href: `#/${lvlId}/${tid}/${k}`, class: k === tab ? "active" : "", role: "tab" }, label))));
  const body = h("div", { class: "tabbody" });
  root.append(body);

  if (tab === "leccion") {
    body.append(h("div", { class: "card goals" }, h("h3", {}, "Al terminar este tema podrás…"), h("ul", {}, topic.goals.map((g) => h("li", {}, g)))));
    const md = await getText(`content/${lvlId}/${tid}/leccion.md`);
    body.append(h("article", { class: "lesson", html: markdown(md.replace(/^# .*\n/, "")) }));
    body.append(h("div", { class: "next" }, h("a", { class: "btn", href: `#/${lvlId}/${tid}/vocabulario` }, "Siguiente: vocabulario →")));
  } else if (tab === "vocabulario") {
    renderVocab(body, topic);
  } else if (tab === "ejercicios") {
    for (const ex of topic.exercises) body.append(renderExercise(ex, topic));
    body.append(h("div", { class: "next" }, h("a", { class: "btn", href: `#/${lvlId}/${tid}/examenes` }, "Siguiente: exámenes →")));
  } else if (tab === "examenes") {
    const fmt = cur.examFormats[lvlId];
    const prior = lvl.topics.slice(0, idx + 1).filter((t) => t.status === "ready").length;
    const card = (mode, title, text) => {
      const att = examAttempts(topic.id, mode);
      const last = att[att.length - 1];
      return h("div", { class: "card exam-card" },
        h("h3", {}, title), h("p", {}, text),
        h("div", { class: "chips" },
          fmt.modules.map((m) => h("span", { class: "chip muted" }, `${m.name}: ${m.teile.reduce((a, t) => a + (t[mode === "tema" ? "n_tema" : "n_global"] || 0), 0)} tareas`))),
        att.length ? h("p", { class: "muted" }, `Intentos: ${att.length} · último ${last.total}% · mejor ${Math.max(...att.map((a) => a.total))}%`) : null,
        h("a", { class: "btn", href: `#/${lvlId}/${tid}/examen/${mode}` }, "Empezar"));
    };
    body.append(
      h("p", {}, `Los dos exámenes siguen el formato del ${lvl.exam}: Hören, Lesen, Schreiben y Sprechen. Cada intento saca preguntas distintas del banco. Aprobado: ${fmt.passPercent}% en cada módulo.`),
      h("div", { class: "exam-grid" },
        card("tema", "Examen del tema", "Solo contenido de este tema. Hazlo cuando termines los ejercicios."),
        card("global", "Examen global", prior > 1 ? `Mezcla preguntas de los ${prior} temas de ${lvl.name} vistos hasta ahora.` : "Mezcla todos los temas vistos hasta ahora. Como es el primer tema, de momento usa el mismo banco con más preguntas.")));
  }
}

function renderVocab(body, topic) {
  const inSrs = topic.vocab.some((v) => srsAll()[`${topic.id}|${v.de}`]);
  body.append(
    h("div", { class: "card row" },
      h("p", {}, inSrs ? "Este vocabulario ya está en tu repaso diario." : "Añade estas palabras a tu repaso espaciado: te las preguntará en los días justos para no olvidarlas."),
      inSrs ? h("a", { class: "btn", href: "#/repaso" }, "Ir al repaso") : h("button", { class: "btn", onclick: (e) => { srsAdd(topic); e.target.replaceWith(h("a", { class: "btn", href: "#/repaso" }, "Añadido · Ir al repaso")); updateRepasoBadge(); } }, "Añadir al repaso"))
  );
  const cats = [...new Set(topic.vocab.map((v) => v.cat))];
  for (const cat of cats) {
    body.append(h("h3", {}, cat));
    const tbl = h("div", { class: "vocab" });
    for (const v of topic.vocab.filter((x) => x.cat === cat)) {
      tbl.append(h("div", { class: "vrow" },
        speakBtn([{ v: "f1", t: v.de }]),
        h("div", { class: "vde", lang: "de" }, h("strong", {}, v.de), v.pl ? h("span", { class: "muted" }, ` · Pl. ${v.pl}`) : null, v.forms ? h("div", { class: "muted small" }, v.forms) : null),
        h("div", { class: "ves" }, v.es),
        h("div", { class: "vex" }, v.ex ? [speakBtn([{ v: "m1", t: v.ex }], "Escuchar ejemplo"), h("span", { lang: "de" }, v.ex), h("div", { class: "muted small" }, v.ex_es)] : null)));
    }
    body.append(tbl);
  }
}

/* ------------------------------------------------------------------ exercises */
function saveEx(topic, ex, pct) {
  const prev = store.get(exKey(topic.id, ex.id), null);
  store.set(exKey(topic.id, ex.id), Math.max(prev ?? 0, pct));
}
function exShell(ex, topic, bodyEl, check) {
  const prev = store.get(exKey(topic.id, ex.id), null);
  const result = h("div", { class: "result", "aria-live": "polite" });
  const wrap = h("section", { class: "card exercise", id: ex.id },
    h("header", {}, h("h3", {}, ex.title), prev !== null ? h("span", { class: `chip ${prev >= 80 ? "pass" : "muted"}` }, `Mejor: ${prev}%`) : null),
    h("p", { class: "muted" }, ex.instructions),
    bodyEl,
    h("div", { class: "actions" },
      h("button", { class: "btn", type: "button", onclick: () => {
        const { ok, total } = check();
        const pct = Math.round((100 * ok) / total);
        saveEx(topic, ex, pct);
        result.textContent = `${ok} de ${total} correctas (${pct}%)`;
        result.className = `result ${pct >= 80 ? "good" : "bad"}`;
      } }, "Comprobar"),
      h("button", { class: "btn ghost", type: "button", onclick: () => wrap.replaceWith(renderExercise(ex, topic)) }, "Reiniciar"),
      result));
  return wrap;
}
function mark(el, state, msg) {
  el.classList.remove("ok", "no", "case");
  el.classList.add(state);
  const fb = el.querySelector(".fb") || el.appendChild(h("div", { class: "fb" }));
  fb.innerHTML = msg || "";
}

function renderExercise(ex, topic) {
  const renderers = { mc: exMC, listen: exMC, match: exMatch, gap: exGap, order: exOrder, dictation: exDictation, write: exWrite };
  const r = renderers[ex.type];
  if (!r) return h("div", { class: "card error" }, `Tipo de ejercicio desconocido: ${ex.type}`);
  const { body, check } = r(ex);
  return exShell(ex, topic, body, check);
}

function exMC(ex) {
  const name = () => `${ex.id}-${Math.random().toString(36).slice(2)}`;
  const items = ex.items.map((orig, idx) => {
    const it = shuffleOptions(orig);
    const n = name();
    const opts = it.options.map((o, i) => h("label", { class: "opt" }, h("input", { type: "radio", name: n, value: i }), h("span", { lang: ex.type === "listen" ? null : "de" }, o)));
    const el = h("div", { class: "item" },
      h("div", { class: "q" }, h("span", { class: "n" }, `${idx + 1}.`), it.audio ? speakBtn(it.audio) : null, it.q),
      h("div", { class: "opts" }, opts));
    return { el, it };
  });
  return {
    body: h("div", {}, items.map((x) => x.el)),
    check() {
      let ok = 0;
      for (const { el, it } of items) {
        const sel = el.querySelector("input:checked");
        const right = sel && +sel.value === it.answer;
        if (right) ok++;
        const transcript = it.audio ? `<div class="transcript" lang="de">${it.audio.map((l) => esc(l.t)).join("<br>")}</div>` : "";
        mark(el, right ? "ok" : "no", `${right ? "✓" : `✗ Correcta: <strong>${esc(it.options[it.answer])}</strong>`}${it.explain ? ` — ${esc(it.explain)}` : ""}${transcript}`);
      }
      return { ok, total: items.length };
    },
  };
}

function exMatch(ex) {
  const rights = shuffle(ex.pairs.map((p) => p[1]));
  const rows = ex.pairs.map(([l, r]) => {
    const sel = h("select", {}, h("option", { value: "" }, "—"), rights.map((x) => h("option", { value: x }, x)));
    return { el: h("div", { class: "item match" }, h("span", { lang: "de", class: "mleft" }, speakBtn([{ v: "f1", t: l }]), l), sel), r, sel };
  });
  return {
    body: h("div", {}, rows.map((x) => x.el)),
    check() {
      let ok = 0;
      for (const { el, r, sel } of rows) {
        const right = sel.value === r;
        if (right) ok++;
        mark(el, right ? "ok" : "no", right ? "✓" : `✗ ${esc(r)}`);
      }
      return { ok, total: rows.length };
    },
  };
}

function exGap(ex) {
  const items = ex.items.map((it, idx) => {
    const inputs = [];
    const parts = it.text.split(/(\[\[.+?\]\])/);
    const line = h("div", { class: "q gapline", lang: "de" }, h("span", { class: "n" }, `${idx + 1}.`));
    for (const p of parts) {
      const m = p.match(/^\[\[(.+)\]\]$/);
      if (m) {
        const answers = m[1].split("/");
        const inp = h("input", { type: "text", class: "gap", autocomplete: "off", autocapitalize: "off", spellcheck: "false", size: Math.max(4, answers[0].length + 1) });
        inputs.push({ inp, answers });
        line.append(inp);
      } else line.append(p);
    }
    const el = h("div", { class: "item" }, line, it.note ? h("div", { class: "muted small" }, it.note) : null);
    return { el, inputs };
  });
  return {
    body: h("div", {}, items.map((x) => x.el)),
    check() {
      let ok = 0, total = 0;
      for (const { el, inputs } of items) {
        let all = true, caseOnly = false;
        for (const { inp, answers } of inputs) {
          total++;
          const r = compare(inp.value, answers);
          if (r === "ok") ok++;
          else if (r === "case") { caseOnly = true; all = false; }
          else all = false;
          inp.classList.toggle("wrong", r !== "ok");
        }
        const sol = inputs.map((x) => x.answers[0]).join(" · ");
        mark(el, all ? "ok" : caseOnly ? "case" : "no", all ? "✓" : caseOnly ? `Casi: ojo con las mayúsculas → <strong>${esc(sol)}</strong>` : `✗ <strong>${esc(sol)}</strong>`);
      }
      return { ok, total };
    },
  };
}

function exOrder(ex) {
  const items = ex.items.map((it, idx) => {
    const built = h("div", { class: "built", lang: "de" });
    const pool = h("div", { class: "pool", lang: "de" });
    const chosen = [];
    const redraw = () => {
      built.innerHTML = "";
      chosen.forEach((w, i) => built.append(h("button", { type: "button", class: "chip word on", onclick: () => { chosen.splice(i, 1); redraw(); } }, w.text)));
      pool.querySelectorAll("button").forEach((b) => (b.disabled = chosen.some((c) => c.id === +b.dataset.id)));
    };
    // Los signos de puntuación no se ordenan: se añaden solos al final.
    const punct = it.words.filter((w) => /^[.?!]$/.test(w)).join("");
    shuffle(it.words.map((w, i) => ({ text: w, id: i })).filter((w) => !/^[.?!]$/.test(w.text))).forEach((w) =>
      pool.append(h("button", { type: "button", class: "chip word", "data-id": w.id, onclick: () => { chosen.push(w); redraw(); } }, w.text)));
    const el = h("div", { class: "item" }, h("div", { class: "q" }, h("span", { class: "n" }, `${idx + 1}.`)), built, pool);
    // La primera palabra se pone en mayúscula sola (así "heute" puede ir delante).
    const sentence = () => {
      const t = chosen.map((w) => w.text).join(" ").replace(/\s+([,.!?])/g, "$1") + punct;
      return t.charAt(0).toUpperCase() + t.slice(1);
    };
    return { el, it, sentence };
  });
  return {
    body: h("div", {}, items.map((x) => x.el)),
    check() {
      let ok = 0;
      for (const { el, it, sentence } of items) {
        // Las fichas traen su propia mayúscula, así que aquí no se penalizan las mayúsculas.
        const right = compare(sentence(), it.answers) !== "no";
        if (right) ok++;
        mark(el, right ? "ok" : "no", right ? "✓" : `✗ <strong>${esc(it.answers[0])}</strong>`);
      }
      return { ok, total: items.length };
    },
  };
}

function exDictation(ex) {
  const items = ex.items.map((it, idx) => {
    const inp = h("input", { type: "text", autocomplete: "off", spellcheck: "false", placeholder: "Escribe lo que oyes" });
    return { el: h("div", { class: "item" }, h("div", { class: "q" }, h("span", { class: "n" }, `${idx + 1}.`), speakBtn(it.audio), inp)), it, inp };
  });
  return {
    body: h("div", {}, items.map((x) => x.el)),
    check() {
      let ok = 0;
      for (const { el, it, inp } of items) {
        const r = compare(inp.value, it.answers);
        if (r === "ok") ok++;
        mark(el, r, r === "ok" ? "✓" : `${r === "case" ? "Casi: mayúsculas." : "✗"} <strong>${esc(it.answers[0])}</strong> <span class="transcript" lang="de">${esc(it.audio.map((l) => l.t).join(" "))}</span>`);
      }
      return { ok, total: items.length };
    },
  };
}

function exWrite(ex) {
  const items = ex.items.map((it, idx) => {
    const inp = h("input", { type: "text", class: "wide", autocomplete: "off", spellcheck: "false", lang: "de" });
    return { el: h("div", { class: "item" }, h("div", { class: "q" }, h("span", { class: "n" }, `${idx + 1}.`), it.prompt), inp), it, inp };
  });
  return {
    body: h("div", {}, items.map((x) => x.el)),
    check() {
      let ok = 0;
      for (const { el, it, inp } of items) {
        const r = compare(inp.value, it.answers);
        if (r === "ok") ok++;
        const alts = it.answers.map(esc).join("<br>");
        mark(el, r, r === "ok" ? `✓ ${it.answers.length > 1 ? `<span class="muted">También vale: ${it.answers.filter((a) => norm(a) !== norm(inp.value)).map(esc).join(" · ")}</span>` : ""}` : `${r === "case" ? "Casi: revisa las mayúsculas." : "✗ Respuestas aceptadas:"}<br><strong lang="de">${alts}</strong>`);
      }
      return { ok, total: items.length };
    },
  };
}

/* ------------------------------------------------------------------ exams */
// Construye un examen muestreando del banco de uno o varios temas, respetando el formato del nivel.
async function buildExam(cur, lvlId, tid, mode) {
  const lvl = cur.levels.find((l) => l.id === lvlId);
  const fmt = cur.examFormats[lvlId];
  const idx = lvl.topics.findIndex((t) => t.id === tid);
  const topicIds = mode === "tema" ? [tid] : lvl.topics.slice(0, idx + 1).filter((t) => t.status === "ready").map((t) => t.id);
  const topics = await Promise.all(topicIds.map((t) => loadTopic(lvlId, t)));
  const modules = fmt.modules.map((m) => ({
    ...m,
    teile: m.teile.map((teil) => {
      const n = teil[mode === "tema" ? "n_tema" : "n_global"];
      // Reparto por turnos entre temas para que el global cubra todos.
      const pools = shuffle(topics.map((tp) => shuffle((tp.exam?.[m.key]?.[teil.key] || []).map((it) => ({ ...it, _topic: tp.id })))));
      const picked = [];
      while (picked.length < n && pools.some((p) => p.length)) for (const p of pools) if (p.length && picked.length < n) picked.push(p.shift());
      return { ...teil, items: picked };
    }),
  }));
  return { modules, topicIds };
}

function recorder() {
  const box = h("div", { class: "recorder" });
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    box.append(h("p", { class: "muted small" }, "Tu navegador no permite grabar. Habla en voz alta igualmente."));
    return box;
  }
  let rec = null, chunks = [];
  const btn = h("button", { class: "btn ghost", type: "button" }, "● Grabar");
  const player = h("audio", { controls: true, hidden: true });
  btn.onclick = async () => {
    if (rec && rec.state === "recording") { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec = new MediaRecorder(stream);
      chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        player.src = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }));
        player.hidden = false;
        btn.textContent = "● Grabar de nuevo";
        btn.classList.remove("rec");
      };
      rec.start();
      btn.textContent = "■ Parar";
      btn.classList.add("rec");
    } catch {
      box.append(h("p", { class: "muted small" }, "No se pudo acceder al micrófono."));
    }
  };
  box.append(btn, player);
  return box;
}

function listenControl(lines, plays) {
  let left = plays;
  const btn = h("button", { class: "btn listen", type: "button" });
  const label = () => (btn.textContent = left > 0 ? `▶ Escuchar (${left} ${left === 1 ? "vez" : "veces"})` : "Sin reproducciones");
  label();
  btn.onclick = () => {
    if (left <= 0) return;
    left--;
    btn.disabled = true;
    btn.textContent = "… reproduciendo";
    play(lines, { onend: () => { btn.disabled = left <= 0; label(); } });
  };
  return btn;
}

async function viewExam(root, lvlId, tid, mode) {
  const cur = await curriculum();
  const lvl = cur.levels.find((l) => l.id === lvlId);
  const topic = await loadTopic(lvlId, tid);
  const fmt = cur.examFormats[lvlId];
  const exam = await buildExam(cur, lvlId, tid, mode);
  const started = Date.now();
  const graders = { hoeren: [], lesen: [], schreiben: [], sprechen: [] };
  const selfEval = []; // se muestran tras entregar

  root.append(
    h("nav", { class: "crumbs" }, h("a", { href: "#/" }, "Inicio"), " / ", h("a", { href: `#/${lvlId}` }, lvl.name), " / ", h("a", { href: `#/${lvlId}/${tid}/examenes` }, topic.title)),
    h("h1", {}, mode === "tema" ? "Examen del tema" : "Examen global"),
    h("p", { class: "muted" }, `Formato ${lvl.exam}. ${mode === "global" ? `Temas incluidos: ${exam.topicIds.length}. ` : ""}Contesta todo y pulsa «Entregar» al final. Las instrucciones van en alemán, como en el examen real.`)
  );
  const timer = h("div", { class: "timer" }, "00:00");
  const tick = setInterval(() => {
    if (!document.body.contains(timer)) return clearInterval(tick);
    const s = Math.floor((Date.now() - started) / 1000);
    timer.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);
  root.append(h("div", { class: "sticky" }, h("div", { class: "modnav" }, exam.modules.map((m) => h("a", { href: "javascript:void 0", onclick: () => document.getElementById(`mod-${m.key}`).scrollIntoView({ behavior: "smooth" }) }, m.name))), timer));

  let q = 0;
  for (const m of exam.modules) {
    const sec = h("section", { class: "module", id: `mod-${m.key}` }, h("h2", {}, m.name, h("span", { class: "muted small" }, ` · examen real: ${m.minutes} min`)));
    for (const teil of m.teile) {
      if (!teil.items.length) continue;
      const tsec = h("div", { class: "card teil" }, h("h3", {}, `Teil ${teil.key.slice(1)}`), h("p", { class: "instr", lang: "de" }, teil.de), h("p", { class: "muted small" }, teil.es));
      for (let it of teil.items) {
        q++;
        const el = h("div", { class: "item" });
        if (teil.kind === "listen_mc" || teil.kind === "listen_tf") {
          const n = `q${q}`;
          if (teil.kind === "listen_mc") it = shuffleOptions(it);
          const opts = teil.kind === "listen_mc" ? it.options : ["Richtig", "Falsch"];
          el.append(h("div", { class: "q" }, h("span", { class: "n" }, `${q}.`), h("span", { lang: "de" }, it.q || it.statement)), listenControl(it.audio, teil.plays),
            h("div", { class: "opts" }, opts.map((o, i) => h("label", { class: "opt" }, h("input", { type: "radio", name: n, value: i }), h("span", { lang: "de" }, `${teil.kind === "listen_mc" ? "abc"[i] + ") " : ""}${o}`)))));
          const right = teil.kind === "listen_mc" ? it.answer : it.answer ? 0 : 1;
          graders[m.key].push(() => {
            const sel = el.querySelector("input:checked");
            const ok = sel && +sel.value === right;
            mark(el, ok ? "ok" : "no", `${ok ? "✓" : `✗ ${esc(opts[right])}`}<div class="transcript" lang="de">${it.audio.map((l) => esc(l.t)).join("<br>")}</div>`);
            return [ok ? 1 : 0, 1];
          });
        } else if (teil.kind === "read_tf") {
          q--; // la numeración va por afirmación, no por texto
          el.append(h("div", { class: it.sign ? "sign" : "text", lang: "de" }, it.text));
          const rows = it.statements.map((st) => {
            q++;
            const n = `q${q}`;
            const row = h("div", { class: "tfrow" }, h("span", { class: "n" }, `${q}.`), h("span", { lang: "de", class: "stmt" }, st.s),
              h("label", { class: "opt" }, h("input", { type: "radio", name: n, value: "1" }), "Richtig"),
              h("label", { class: "opt" }, h("input", { type: "radio", name: n, value: "0" }), "Falsch"));
            el.append(row);
            return { row, st };
          });
          graders[m.key].push(() => {
            let ok = 0;
            for (const { row, st } of rows) {
              const sel = row.querySelector("input:checked");
              const r = sel && (sel.value === "1") === st.answer;
              if (r) ok++;
              row.classList.remove("ok", "no");
              row.classList.add(r ? "ok" : "no");
            }
            return [ok, rows.length];
          });
        } else if (teil.kind === "read_ab") {
          const n = `q${q}`;
          el.append(h("div", { class: "q" }, h("span", { class: "n" }, `${q}.`), h("span", { lang: "de" }, it.situation)),
            h("div", { class: "ab" }, ["a", "b"].map((k) => h("label", { class: "abcard" }, h("input", { type: "radio", name: n, value: k }), h("span", { class: "abk" }, k), h("span", { lang: "de" }, it[k])))));
          graders[m.key].push(() => {
            const sel = el.querySelector("input:checked");
            const ok = sel && sel.value === it.answer;
            mark(el, ok ? "ok" : "no", ok ? "✓" : `✗ Correcta: ${it.answer}`);
            return [ok ? 1 : 0, 1];
          });
        } else if (teil.kind === "form") {
          const fields = it.fields.map((f) => {
            const inp = h("input", { type: "text", value: f.given || "", readonly: f.given ? true : null, autocomplete: "off", spellcheck: "false" });
            return { f, inp, row: h("label", { class: "frow" }, h("span", {}, f.label), inp) };
          });
          el.append(h("div", { class: "text", lang: "de" }, it.context), h("div", { class: "form" }, h("div", { class: "ftitle", lang: "de" }, it.title), fields.map((x) => x.row)));
          graders[m.key].push(() => {
            let ok = 0, tot = 0;
            for (const { f, inp, row } of fields) {
              if (f.given) continue;
              tot++;
              const r = compare(inp.value, f.answers) !== "no" || compare(inp.value.replace(/\s+/g, ""), f.answers.map((a) => a.replace(/\s+/g, ""))) !== "no";
              if (r) ok++;
              row.classList.remove("ok", "no");
              row.classList.add(r ? "ok" : "no");
              if (!r) row.append(h("em", { class: "small" }, ` → ${f.answers[0]}`));
            }
            return [ok, tot];
          });
        } else if (teil.kind === "write_free") {
          const ta = h("textarea", { rows: 7, lang: "de", spellcheck: "false", placeholder: "Schreiben Sie hier…" });
          const wc = h("span", { class: "muted small" }, "0 Wörter");
          ta.addEventListener("input", () => (wc.textContent = `${(ta.value.match(/\S+/g) || []).length} Wörter`));
          el.append(h("p", { lang: "de" }, it.task), h("ul", { lang: "de" }, it.points.map((p) => h("li", {}, p))), h("p", { class: "muted small" }, `Registro: ${it.register}`), ta, wc);
          const checks = [...it.points.map((p) => `Respondo a: «${p}»`), "Saludo y despedida adecuados al registro", "Casi todas las frases son correctas (verbo en posición 2, conjugación)"];
          selfEval.push({ module: "schreiben", el, weight: 2, checks, extra: () => [
            h("div", { class: "model" }, h("strong", {}, "Texto modelo"), h("pre", { lang: "de" }, it.model)),
            h("button", { class: "btn ghost", type: "button", onclick: (e) => copyForClaude(e.target, it, ta.value, lvl) }, "Copiar para corregir con Claude"),
          ] });
        } else if (teil.kind === "speak_intro") {
          el.append(h("p", { lang: "de" }, "Stellen Sie sich vor:"), h("div", { class: "keywords", lang: "de" }, it.keywords.map((k) => h("span", { class: "kw" }, k))), h("p", { class: "muted small", lang: "de" }, it.extra), recorder());
          selfEval.push({ module: "sprechen", el, weight: 1, checks: [...it.keywords.map((k) => `He dicho «${k}»`), "He deletreado mi nombre sin errores", "He hablado con frases completas (sujeto + verbo)"], extra: () => [h("div", { class: "model" }, h("strong", {}, "Modelo "), speakBtn(it.model), h("p", { lang: "de" }, it.model.map((l) => l.t).join(" ")))] });
        } else if (teil.kind === "speak_cards") {
          el.append(h("div", { class: "cardword" }, h("small", {}, `Thema: ${it.theme}`), h("strong", { lang: "de" }, it.word)), h("p", { class: "muted small" }, "Haz una pregunta con esta palabra y contéstala tú mismo (o con tu pareja de estudio)."), recorder());
          selfEval.push({ module: "sprechen", el, weight: 1, checks: ["Mi pregunta es correcta", "Mi respuesta es correcta"], extra: () => [h("div", { class: "model" }, speakBtn([{ v: "f2", t: it.question }, { v: "m1", t: it.answer }]), h("span", { lang: "de" }, `${it.question} – ${it.answer}`))] });
        }
        tsec.append(el);
      }
      sec.append(tsec);
    }
    root.append(sec);
  }

  const submit = h("button", { class: "btn big", type: "button" }, "Entregar");
  root.append(h("div", { class: "submitbar" }, submit));
  submit.onclick = () => {
    stopAudio();
    clearInterval(tick);
    submit.disabled = true;
    root.querySelectorAll(".module input, .module textarea, .module .listen").forEach((x) => { if (x.tagName !== "TEXTAREA") x.disabled = true; else x.readOnly = true; });
    const scores = {};
    for (const [k, gs] of Object.entries(graders)) {
      scores[k] = gs.reduce(([a, b], g) => { const [x, y] = g(); return [a + x, b + y]; }, [0, 0]);
    }
    const results = h("section", { class: "card results", id: "results" });
    const selfBoxes = { schreiben: [], sprechen: [] };
    for (const s of selfEval) {
      const boxes = s.checks.map((c) => h("label", { class: "opt" }, h("input", { type: "checkbox" }), c));
      selfBoxes[s.module].push({ boxes, weight: s.weight });
      s.el.append(h("div", { class: "selfeval" }, h("strong", {}, "Autoevaluación"), s.extra(), boxes));
      boxes.forEach((b) => b.querySelector("input").addEventListener("change", render));
    }
    function compute() {
      const out = {};
      for (const m of exam.modules) {
        let [a, b] = scores[m.key] || [0, 0];
        for (const { boxes, weight } of selfBoxes[m.key] || []) {
          a += weight * boxes.filter((x) => x.querySelector("input").checked).length;
          b += weight * boxes.length;
        }
        if (b > 0) out[m.key] = Math.round((100 * a) / b);
      }
      return out;
    }
    const saveBtn = h("button", { class: "btn", type: "button" }, "Guardar resultado");
    function render() {
      const pcts = compute();
      const vals = Object.values(pcts);
      const total = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      results.innerHTML = "";
      results.append(h("h2", {}, "Resultado"),
        h("div", { class: "scores" }, exam.modules.filter((m) => m.key in pcts).map((m) => h("div", { class: `score ${pcts[m.key] >= fmt.passPercent ? "pass" : "fail"}` }, h("span", {}, m.name), h("strong", {}, `${pcts[m.key]}%`)))),
        h("p", { class: "muted" }, "Hören, Lesen y el formulario se corrigen solos. Para el texto libre y la parte oral, marca la autoevaluación que aparece en cada tarea: la nota se actualiza al momento."),
        saveBtn);
      saveBtn.onclick = () => {
        const list = examAttempts(topic.id, mode);
        list.push({ date: new Date().toISOString(), modules: pcts, total, seconds: Math.round((Date.now() - started) / 1000) });
        store.set(`exam:${topic.id}:${mode}`, list);
        topicSummary(topic);
        saveBtn.replaceWith(h("span", { class: "chip pass" }, "Guardado ✓"), " ", h("a", { class: "btn ghost", href: `#/${lvlId}/${tid}/examenes` }, "Volver"), " ", h("button", { class: "btn ghost", type: "button", onclick: route }, "Nuevo intento"));
      };
    }
    render();
    submit.parentElement.replaceWith(results);
    results.scrollIntoView({ behavior: "smooth" });
  };
}

function copyForClaude(btn, task, text, lvl) {
  const prompt = `Eres examinador del ${lvl.exam}. Corrige este texto de un estudiante hispanohablante (nivel ${lvl.name}).

Tarea: ${task.task}
Puntos que debe tratar: ${task.points.join(" / ")}
Registro: ${task.register}

Texto del estudiante:
"""
${text || "(vacío)"}
"""

1. Puntúa según los criterios del Goethe para ${lvl.name} (cumplimiento de la tarea, comunicación, corrección) y di si aprobaría.
2. Lista cada error con su corrección y explica la regla en español en una línea.
3. Reescribe el texto corregido manteniendo mi nivel.`;
  navigator.clipboard?.writeText(prompt).then(
    () => (btn.textContent = "Copiado ✓ — pégalo en Claude"),
    () => { btn.replaceWith(h("textarea", { rows: 8, readonly: true }, prompt)); }
  );
}

/* ------------------------------------------------------------------ repaso */
async function viewRepaso(root) {
  root.append(h("h1", {}, "Repaso de vocabulario"));
  const cards = await srsDue();
  const total = Object.keys(srsAll()).length;
  if (!total) {
    root.append(h("div", { class: "card" }, h("p", {}, "Aún no has añadido vocabulario. Entra en un tema → Vocabulario → «Añadir al repaso»."), h("a", { class: "btn", href: "#/a1" }, "Ir a A1")));
    return;
  }
  if (!cards.length) {
    root.append(h("div", { class: "card" }, h("p", {}, `¡Todo al día! Tienes ${total} palabras en el sistema; vuelve mañana.`)));
    return;
  }
  let dir = store.get("srsdir", "es-de");
  const stage = h("div", {});
  const dirSel = h("select", { onchange: (e) => { dir = e.target.value; store.set("srsdir", dir); show(); } },
    h("option", { value: "es-de", selected: dir === "es-de" }, "Español → Alemán"), h("option", { value: "de-es", selected: dir === "de-es" }, "Alemán → Español"));
  const counter = h("span", { class: "muted" });
  root.append(h("div", { class: "row" }, counter, h("label", {}, "Dirección: ", dirSel)), stage);
  let i = 0;
  function show() {
    stage.innerHTML = "";
    counter.textContent = `${Math.min(i + 1, cards.length)} / ${cards.length}`;
    if (i >= cards.length) {
      stage.append(h("div", { class: "card" }, h("p", {}, "Sesión terminada. ¡Bien hecho!"), h("a", { class: "btn", href: "#/" }, "Inicio")));
      updateRepasoBadge();
      return;
    }
    const { key, v } = cards[i];
    const front = dir === "es-de" ? h("div", { class: "fc-front" }, v.es) : h("div", { class: "fc-front", lang: "de" }, v.de, speakBtn([{ v: "f1", t: v.de }]));
    const back = h("div", { class: "fc-back", hidden: true },
      h("div", { lang: "de", class: "fc-de" }, speakBtn([{ v: "f1", t: v.de }]), h("strong", {}, v.de), v.pl ? h("span", { class: "muted" }, ` · Pl. ${v.pl}`) : null),
      h("div", {}, v.es), v.ex ? h("div", { class: "muted", lang: "de" }, v.ex) : null,
      h("div", { class: "actions" },
        h("button", { class: "btn ghost", type: "button", onclick: () => { srsGrade(key, false); cards.push(cards[i]); i++; show(); } }, "Otra vez"),
        h("button", { class: "btn", type: "button", onclick: () => { srsGrade(key, true); i++; show(); } }, "Lo sabía")));
    const reveal = h("button", { class: "btn", type: "button", onclick: () => { back.hidden = false; reveal.remove(); } }, "Mostrar respuesta");
    stage.append(h("div", { class: "card flashcard" }, front, reveal, back));
  }
  show();
}

/* ------------------------------------------------------------------ ajustes */
function viewAjustes(root) {
  const s = settings();
  root.append(h("h1", {}, "Ajustes"));
  const rate = h("select", { onchange: (e) => store.set("settings", { ...settings(), rate: +e.target.value }) },
    [0.7, 0.8, 0.9, 1].map((r) => h("option", { value: r, selected: s.rate === r }, r === 1 ? "Normal" : `${Math.round(r * 100)}%`)));
  const voices = deVoices.length ? deVoices.map((v) => v.name).join(", ") : "ninguna detectada";
  root.append(
    h("div", { class: "card" }, h("h3", {}, "Audio"), h("label", {}, "Velocidad: ", rate),
      h("p", { class: "muted small" }, `Audios pregenerados disponibles: ${manifest.size}. Si falta alguno se usa la voz del navegador. Voces alemanas del navegador: ${voices}.`),
      h("button", { class: "btn ghost", type: "button", onclick: () => play([{ v: "f1", t: "Hallo! Ich heiße Anna." }, { v: "m1", t: "Freut mich! Ich bin Jonas." }]) }, "Probar voces")),
    h("div", { class: "card" }, h("h3", {}, "Tu progreso"), h("p", { class: "muted small" }, "El progreso se guarda en este navegador. Expórtalo para pasarlo a otro dispositivo."),
      h("div", { class: "actions" },
        h("button", { class: "btn ghost", type: "button", onclick: () => {
          const blob = new Blob([JSON.stringify(store.all(), null, 1)], { type: "application/json" });
          h("a", { href: URL.createObjectURL(blob), download: `progreso-aleman-${new Date().toISOString().slice(0, 10)}.json` }).click();
        } }, "Exportar"),
        h("label", { class: "btn ghost" }, "Importar", h("input", { type: "file", accept: "application/json", hidden: true, onchange: async (e) => {
          const data = JSON.parse(await e.target.files[0].text());
          Object.entries(data).forEach(([k, v]) => store.set(k, v));
          alert("Progreso importado.");
          route();
        } }))))
  );
}
})();
