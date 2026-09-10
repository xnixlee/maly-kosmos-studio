import { setupSettings } from "./settings.js";
import { setupAccount } from "./account.js";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function api(url, method = "GET", data) {
  const r = await fetch(url, {
    method,
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.error || "Не удалось выполнить действие.");
  return v;
}
function toast(text, error = false) {
  const el = $("#toast");
  el.textContent = text;
  el.className = "toast" + (error ? " error" : "");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(
    () => el.classList.add("hidden"),
    error ? 12000 : 4500,
  );
}
const safe =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      toast(e.message, true);
    }
  };
let state;
try {
  state = await api("/api/bootstrap");
} catch (e) {
  $("#engine-badge").textContent = "Сервер недоступен";
  $("#editor").textContent = e.message;
  throw e;
}
let selected = ["kvasar", "perigey"],
  current = null,
  tab = "script",
  job = null,
  pollTimer = null,
  dirty = false,
  page = "studio";
let prefs;
try {
  prefs = JSON.parse(localStorage.getItem("cosmos-preferences"));
} catch {}
const formKeys = [
  "prompt",
  "place",
  "format",
  "duration",
  "count",
  "absurd",
  "warmth",
  "dread",
  "ending",
  "constraints",
  "temperature",
  "seed",
];
const avatar = (c) =>
  c.portraitData
    ? `<img class="avatar" src="${esc(c.portraitData)}" alt="${esc(c.name)}">`
    : c.portrait === null || c.portrait === undefined
      ? `<span class="avatar custom-avatar">${esc(c.name.slice(0, 2))}</span>`
      : `<span class="avatar" style="background-position:${(c.portrait % 3) * 50}% ${Math.floor(c.portrait / 3) * 100}%"></span>`;
function voiceOptions(id) {
  return (
    (state.voices.some((v) => v.id === id)
      ? ""
      : `<option value="${esc(id)}" selected>${esc(id)} · недоступен</option>`) +
    state.voices
      .map(
        (v) =>
          `<option value="${v.id}" ${v.id === id ? "selected" : ""}>${esc(v.name)}</option>`,
      )
      .join("")
  );
}
function heroPicker() {
  const place = $("#place").value;
  $("#hero-picker").innerHTML = state.world.characters
    .map(
      (c) =>
        `<button type="button" class="hero ${selected.includes(c.id) ? "selected" : ""}" data-hero="${esc(c.id)}" aria-pressed="${selected.includes(c.id)}" title="${esc(c.role)}">${avatar(c)}${esc(c.name)}</button>`,
    )
    .join("");
  $("#selected-count").textContent =
    `${selected.length} из ${state.world.characters.length}`;
  $("#place").innerHTML = state.world.places
    .map((x) => `<option>${esc(x)}</option>`)
    .join("");
  if (state.world.places.includes(place)) $("#place").value = place;
}
function settings() {
  const s = Object.fromEntries(formKeys.map((k) => [k, $("#" + k).value]));
  return { ...s, heroes: selected };
}
function stashPrefs() {
  try {
    localStorage.setItem("cosmos-preferences", JSON.stringify(settings()));
  } catch {}
}
function applySettings(s) {
  selected = (s.heroes || []).filter((id) =>
    state.world.characters.some((c) => c.id === id),
  );
  heroPicker();
  for (const k of formKeys) if (s[k] !== undefined) $("#" + k).value = s[k];
  for (const k of ["absurd", "warmth", "dread"])
    $("#" + k + "-value").textContent = $("#" + k).value;
  stashPrefs();
}
heroPicker();
if (prefs) applySettings(prefs);
$("#hero-picker").onclick = (e) => {
  const b = e.target.closest("[data-hero]");
  if (!b) return;
  if (!selected.includes(b.dataset.hero) && selected.length >= 6)
    return toast("В одной истории — до шести героев.", true);
  selected = selected.includes(b.dataset.hero)
    ? selected.filter((x) => x !== b.dataset.hero)
    : [...selected, b.dataset.hero];
  heroPicker();
  stashPrefs();
};
$("#generator").oninput = () => {
  for (const k of ["absurd", "warmth", "dread"])
    $("#" + k + "-value").textContent = $("#" + k).value;
  stashPrefs();
};
const titles = {
  studio: "Соберём странную историю.",
  library: "Запас странных происшествий.",
  world: "Здесь всё имеет последствия.",
  settings: "Твои модели и движки.",
  account: "OpenAI: ключи и расходы.",
};
function navigate(next) {
  page = next;
  $$(".page").forEach((el) =>
    el.classList.toggle("hidden", el.id !== "page-" + next),
  );
  $$(".nav").forEach((el) =>
    el.classList.toggle("active", el.dataset.page === next),
  );
  $("#page-title").textContent = titles[next];
  if (next === "library") renderLibrary();
  if (next === "account")
    accountUI.refresh().catch((e) => toast(e.message, true));
}
$$("[data-page]").forEach((b) => (b.onclick = () => navigate(b.dataset.page)));
function persistDraft() {
  if (!current) return;
  try {
    localStorage.setItem("cosmos-draft-" + current.id, JSON.stringify(current));
  } catch {
    toast("Черновик не помещается в браузере. Нажми «Сохранить».", true);
  }
}
function markDirty() {
  dirty = true;
  if (current?.audio) delete current.audio;
  persistDraft();
  const b = $("#save-story");
  if (b) b.textContent = "Сохранить правки";
  $("#save-state")?.replaceChildren(document.createTextNode("Есть правки"));
}
function voiceConfig() {
  const chars = current.worldSnapshot?.characters || state.world.characters;
  return (
    current.voiceSettings || {
      voice: "aidar",
      speed: 1,
      pitch: 0,
      assignments: Object.fromEntries(chars.map((c) => [c.name, c.voice])),
    }
  );
}
function chooseStory(r) {
  if (current && dirty) persistDraft();
  current = structuredClone(r);
  dirty = false;
  try {
    const d = JSON.parse(localStorage.getItem("cosmos-draft-" + r.id));
    if (d && d.revision === r.revision) {
      current = d;
      dirty = true;
    }
  } catch {}
  tab = "script";
  renderEditor();
  navigate("studio");
}
const wordCount = () =>
  current.story.scenes.reduce(
    (n, s) => n + s.text.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
function speakers() {
  return [
    "Рассказчик",
    ...(current.worldSnapshot?.characters || state.world.characters)
      .filter((c) => current.settings.heroes.includes(c.id))
      .map((c) => c.name),
  ];
}
function renderEditor() {
  if (!current) {
    $("#editor").innerHTML =
      '<div class="empty"><h2>Здесь появится новая история</h2><p>Выбери героев и придумай первую неприятность.</p></div>';
    return;
  }
  const st = current.story,
    v = voiceConfig();
  $("#editor").innerHTML =
    `<div class="editor-top"><span class="tag">${esc(current.engine)}</span><span id="save-state" class="muted">${dirty ? "Есть правки" : "Сохранено на Mac"}</span></div><input class="title-input" aria-label="Название истории" data-story="title" maxlength="160" value="${esc(st.title)}"><textarea class="logline" aria-label="О чём история" rows="2" maxlength="1000" data-story="logline">${esc(st.logline)}</textarea><div class="editor-meta"><span>${st.scenes.length} сцен</span><span id="word-count">${wordCount()} слов · ≈ ${Math.round(wordCount() / 1.9)} сек речи</span><span>${esc(current.settings.place)}</span></div><div class="tabs"><button class="tab ${tab === "script" ? "active" : ""}" data-tab="script">Сценарий</button><button class="tab ${tab === "shots" ? "active" : ""}" data-tab="shots">Кадры и звук</button><button class="tab ${tab === "voice" ? "active" : ""}" data-tab="voice">Озвучка</button></div>
 ${
   tab === "script"
     ? st.scenes
         .map(
           (s, i) =>
             `<section class="scene"><span class="scene-number">${String(i + 1).padStart(2, "0")}</span><div class="scene-top"><select class="speaker" data-scene="${i}" data-key="speaker" aria-label="Кто говорит в сцене ${i + 1}">${speakers()
               .map(
                 (name) =>
                   `<option ${s.speaker === name ? "selected" : ""}>${esc(name)}</option>`,
               )
               .join(
                 "",
               )}</select><button class="text-button" data-preview-scene="${i}" title="Прослушать сцену">▷ Слушать</button><button class="text-button danger remove-scene" data-remove-scene="${i}" aria-label="Удалить сцену ${i + 1}">×</button></div><textarea class="narration" aria-label="Реплика сцены ${i + 1}" data-scene="${i}" data-key="text" maxlength="1500" rows="${Math.max(2, Math.ceil(s.text.length / 56))}">${esc(s.text)}</textarea><label class="visual-label" for="visual-${i}">В кадре</label><textarea id="visual-${i}" class="scene-visual" data-scene="${i}" data-key="visual" maxlength="2500" rows="2">${esc(s.visual)}</textarea></section>`,
         )
         .join("") +
       '<button id="add-scene" class="text-button">+ Добавить сцену</button>'
     : ""
 }
 ${tab === "shots" ? st.scenes.map((s, i) => `<section class="scene"><span class="scene-number">${String(i + 1).padStart(2, "0")}</span><label>Действие в кадре<textarea data-scene="${i}" data-key="visual" maxlength="2500" rows="3">${esc(s.visual)}</textarea></label><label>Звук и паузы<textarea data-scene="${i}" data-key="sound" maxlength="2500" rows="2">${esc(s.sound)}</textarea></label><label>Промпт для изображения<textarea class="prompt-text" data-scene="${i}" data-key="imagePrompt" maxlength="2500">${esc(s.imagePrompt)}</textarea></label><button class="text-button" data-copy-prompt="${i}">Копировать промпт</button></section>`).join("") : ""}
 ${
   tab === "voice"
     ? `<p class="muted">Каждая реплика получает голос своего героя. Рассказчик озвучивается отдельно.</p><label>Рассказчик<select data-voice="voice">${voiceOptions(v.voice)}</select></label><div class="two"><label>Темп речи<input type="number" data-voice="speed" min="0.7" max="1.4" step="0.05" value="${v.speed}"></label><label>Высота, полутона<input type="number" data-voice="pitch" min="-6" max="6" step="1" value="${v.pitch}"></label></div>${speakers()
         .slice(1)
         .map(
           (name) =>
             `<label class="voice-assignment">${esc(name)}<select data-assignment="${esc(name)}">${voiceOptions(v.assignments[name] || v.voice)}</select></label>`,
         )
         .join(
           "",
         )}<div class="actions voice-actions"><button id="render-audio" class="primary" ${job ? "disabled" : ""}>Озвучить всю историю</button></div><p class="hint">Первая загрузка голоса занимает больше времени. Готовые фразы кешируются.</p>${current.audio ? `<audio controls src="${current.audio.url}"></audio><div class="actions"><a href="${current.audio.url}" download>Скачать WAV</a><a href="${current.audio.subtitles}" download>Субтитры SRT</a><span class="muted">${current.audio.duration.toFixed(1)} сек</span></div>` : ""}`
     : ""
 }
 ${tab !== "voice" ? `<details><summary>Связь с каноном</summary><textarea class="continuity" data-story="continuity" maxlength="2000" rows="3">${esc(st.continuity)}</textarea></details>` : ""}
 <div id="scene-preview"></div><div class="editor-footer"><div class="actions"><button id="save-story">${dirty ? "Сохранить правки" : "Сохранить"}</button><button data-export="md">Сценарий .md</button><button data-export="txt">Текст озвучки</button><button data-export="json">JSON</button><button id="repeat-settings" class="text-button">Настройки этой истории ↖</button></div><div class="rewrite-row"><input id="rewrite-instruction" maxlength="2000" placeholder="Что изменить? Например: меньше объяснений, больше действия" aria-label="Замечание к новой версии"><button id="rewrite" ${job ? "disabled" : ""}>Новая версия</button></div><p class="hint">Новая версия сохранится отдельно. Исходная история останется в библиотеке.</p></div>`;
  $("#editor").oninput = (e) => {
    const el = e.target;
    if (el.dataset.story) {
      current.story[el.dataset.story] = el.value;
      markDirty();
    } else if (el.dataset.scene !== undefined) {
      current.story.scenes[+el.dataset.scene][el.dataset.key] = el.value;
      markDirty();
      if (el.dataset.key === "text")
        $("#word-count").textContent =
          `${wordCount()} слов · ≈ ${Math.round(wordCount() / 1.9)} сек речи`;
    } else if (el.dataset.voice || el.dataset.assignment) {
      current.voiceSettings = structuredClone(voiceConfig());
      if (el.dataset.assignment)
        current.voiceSettings.assignments[el.dataset.assignment] = el.value;
      else
        current.voiceSettings[el.dataset.voice] =
          el.dataset.voice === "voice" ? el.value : Number(el.value);
      markDirty();
    }
  };
}
async function saveStory(quiet = false) {
  if (!current) return;
  const v = await api("/api/stories/" + current.id, "PUT", {
    story: current.story,
    revision: current.revision,
    voiceSettings: voiceConfig(),
  });
  current = v;
  dirty = false;
  localStorage.removeItem("cosmos-draft-" + v.id);
  state.stories = state.stories.map((r) => (r.id === v.id ? v : r));
  if ($("#save-state")) $("#save-state").textContent = "Сохранено на Mac";
  if ($("#save-story")) $("#save-story").textContent = "Сохранить";
  if (!quiet) toast("История сохранена на Mac.");
  return v;
}
$("#editor").onclick = safe(async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.tab) {
    tab = b.dataset.tab;
    renderEditor();
  }
  if (b.id === "save-story") await saveStory();
  if (b.dataset.export) {
    const s = await saveStory(true);
    const link = document.createElement("a");
    link.href = `/api/stories/${s.id}/export?format=${b.dataset.export}`;
    link.download = "";
    link.click();
  }
  if (b.id === "add-scene") {
    if (current.story.scenes.length >= 15)
      return toast("В одной истории можно сохранить до 15 сцен.", true);
    current.story.scenes.push({
      speaker: "Рассказчик",
      text: "Новая реплика.",
      visual: "",
      sound: "",
      imagePrompt: "",
    });
    markDirty();
    renderEditor();
  }
  if (b.dataset.removeScene !== undefined) {
    if (current.story.scenes.length === 1)
      return toast("Оставь хотя бы одну сцену.", true);
    current.story.scenes.splice(+b.dataset.removeScene, 1);
    markDirty();
    renderEditor();
  }
  if (b.dataset.copyPrompt !== undefined) {
    await navigator.clipboard.writeText(
      current.story.scenes[+b.dataset.copyPrompt].imagePrompt,
    );
    toast("Промпт скопирован.");
  }
  if (b.id === "repeat-settings") {
    applySettings(current.settings);
    toast("Настройки истории перенесены в генератор.");
  }
  if (b.id === "rewrite") {
    const instruction = $("#rewrite-instruction").value.trim();
    if (!instruction) throw new Error("Напиши, что изменить в истории.");
    await saveStory(true);
    const s = {
      ...current.settings,
      count: 1,
      seed: Math.floor(Math.random() * 2147483647),
    };
    startJob(
      await api("/api/generate", "POST", {
        settings: s,
        rewrite: { id: current.id, instruction },
      }),
    );
  }
  if (b.id === "render-audio") {
    await saveStory(true);
    startJob(
      await api("/api/stories/" + current.id + "/audio", "POST", voiceConfig()),
    );
  }
  if (b.dataset.previewScene !== undefined) {
    const s = current.story.scenes[+b.dataset.previewScene];
    const v = voiceConfig();
    if (s.text.length > 300)
      throw new Error(
        "Для отдельной пробы сократи реплику до 300 символов. Всю историю можно озвучить без этого ограничения.",
      );
    startJob(
      await api("/api/voice-preview", "POST", {
        ...v,
        voice: v.assignments[s.speaker] || v.voice,
        text: s.text,
      }),
    );
  }
});
$("#generator").onsubmit = safe(async (e) => {
  e.preventDefault();
  startJob(await api("/api/generate", "POST", { settings: settings() }));
});
$("#random-idea").onclick = () => {
  const ideas = state.world.ideas || [];
  const hero =
    state.world.characters.find((c) => selected.includes(c.id)) ||
    state.world.characters[0];
  $("#prompt").value = ideas.length
    ? ideas[Math.floor(Math.random() * ideas.length)]
    : `${hero.name} пытается выполнить обычное дело, но сталкивается с одним из законов мира.`;
  $("#seed").value = "";
  stashPrefs();
};

function renderLibrary() {
  const q = $("#library-search").value.toLowerCase();
  const list = state.stories.filter((r) =>
    JSON.stringify(r.story).toLowerCase().includes(q),
  );
  $("#library-count").textContent = state.stories.length;
  $("#library-grid").innerHTML =
    list
      .map(
        (r) =>
          `<article class="panel story-card"><span class="tag">${esc(r.engine)}</span><h2>${esc(r.story.title)}</h2><p>${esc(r.story.logline)}</p><span class="muted">${new Date(r.createdAt).toLocaleDateString("ru-RU")} · ${r.story.scenes.length} сцен${r.audio ? " · с озвучкой" : ""}${r.parentId ? " · новая версия" : ""}</span><div class="actions"><button data-open="${r.id}">Открыть</button><button class="text-button danger" data-delete="${r.id}">Удалить</button></div></article>`,
      )
      .join("") ||
    '<div class="empty">Здесь пока ничего нет. Новые истории сохраняются автоматически.</div>';
}
$("#library-search").oninput = renderLibrary;
let deleteId = null;
$("#library-grid").onclick = safe(async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.open) chooseStory(await api("/api/stories/" + b.dataset.open));
  if (b.dataset.delete) {
    deleteId = b.dataset.delete;
    $("#confirm-dialog").showModal();
  }
});
$("#keep-story").onclick = () => $("#confirm-dialog").close();
$("#delete-story").onclick = safe(async () => {
  await api("/api/stories/" + deleteId, "DELETE");
  state.stories = state.stories.filter((r) => r.id !== deleteId);
  localStorage.removeItem("cosmos-draft-" + deleteId);
  if (current?.id === deleteId) {
    current = null;
    renderEditor();
  }
  $("#confirm-dialog").close();
  renderLibrary();
  toast("История удалена.");
});
let worldDraft = structuredClone(state.world);
function renderWorld() {
  const w = worldDraft;
  $("#world-editor").innerHTML =
    `<div class="section-head"><h2>Библия мира</h2><button id="save-world" class="primary">Сохранить мир и героев</button></div><div class="world-grid"><div class="panel world-form"><label>Название мира<input data-world="name" maxlength="100" value="${esc(w.name)}"></label><label>О чём этот мир<textarea data-world="premise" rows="4" maxlength="5000">${esc(w.premise)}</textarea></label><label>Рассказчик<textarea data-world="narrator" rows="3" maxlength="3000">${esc(w.narrator || "")}</textarea></label><label>Интонация и правила письма<textarea data-world="style" rows="5" maxlength="5000">${esc(w.style)}</textarea></label></div><div class="panel world-form"><label>Неизменные законы<textarea data-world="laws" rows="8" maxlength="12000">${esc(w.laws)}</textarea></label><label>Места · каждое с новой строки<textarea data-world="places" rows="4">${esc(w.places.join("\n"))}</textarea></label><label>Банк завязок · каждая с новой строки<textarea data-world="ideas" rows="4">${esc((w.ideas || []).join("\n"))}</textarea></label></div></div><div class="section-head character-heading"><h2>Жители · ${w.characters.length}</h2><button id="add-character">+ Свой герой</button></div><div class="character-grid">${w.characters.map((c, i) => `<article class="panel character-editor"><div class="character-header">${avatar(c)}<div><h3>${esc(c.name)}</h3><span class="muted">${esc(c.role)}</span></div></div><label>Портрет<input type="file" accept="image/png,image/jpeg,image/webp" data-portrait="${i}"></label><label>Имя<input data-character="${i}" data-key="name" maxlength="80" value="${esc(c.name)}"></label><label>Роль<input data-character="${i}" data-key="role" maxlength="150" value="${esc(c.role)}"></label><label>Внешность, желания, характер, связи<textarea data-character="${i}" data-key="description" maxlength="3500" rows="7">${esc(c.description)}</textarea></label><label>Голос по умолчанию<select data-character="${i}" data-key="voice">${voiceOptions(c.voice)}</select></label><button class="text-button danger" data-remove-character="${i}">Убрать из новых историй</button></article>`).join("")}</div><p class="hint">Изменения влияют на новые истории. У созданных сценариев сохраняется собственная копия мира.</p>`;
}
$("#world-editor").oninput = (e) => {
  const t = e.target;
  if (t.dataset.world)
    worldDraft[t.dataset.world] = ["places", "ideas"].includes(t.dataset.world)
      ? t.value.split("\n").filter((x) => x.trim())
      : t.value;
  if (t.dataset.character !== undefined)
    worldDraft.characters[+t.dataset.character][t.dataset.key] = t.value;
};
$("#world-editor").onclick = safe(async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.id === "save-world") {
    state.world = await api("/api/world", "PUT", worldDraft);
    selected = selected.filter((id) =>
      state.world.characters.some((c) => c.id === id),
    );
    heroPicker();
    await refreshWorldList();
    toast("Мир и характеры сохранены.");
  }
  if (b.id === "add-character") {
    if (worldDraft.characters.length >= 20)
      throw new Error("Можно добавить до 20 героев.");
    worldDraft.characters.push({
      id: "hero-" + crypto.randomUUID().slice(0, 8),
      name: "Новый сосед",
      role: "",
      description: "",
      voice: "aidar",
      portrait: null,
    });
    renderWorld();
  }
  if (b.dataset.removeCharacter !== undefined) {
    if (worldDraft.characters.length === 1)
      throw new Error("В мире должен остаться хотя бы один герой.");
    worldDraft.characters.splice(+b.dataset.removeCharacter, 1);
    renderWorld();
  }
});
const settingsUI = setupSettings({
  $,
  state,
  api,
  esc,
  safe,
  toast,
  startJob,
  navigate,
});
const accountUI = setupAccount({ $, state, api, esc, safe, toast });

function busy(value) {
  $("#generate").disabled = value;
  $("#generate").textContent = value
    ? "Готовим материал…"
    : "✧  Придумать историю";
  $("#cancel").classList.toggle("hidden", !value);
  $$("#rewrite,#render-audio,[data-test-voice],[data-preview-scene]").forEach(
    (b) => (b.disabled = value),
  );
}
function showJob(j) {
  $("#job-progress").classList.remove("hidden");
  $("#job-stage").textContent = j.stage;
  $("#job-detail").textContent =
    j.type === "story"
      ? `${j.results.length} вариантов сохранено · можно продолжать редактировать`
      : j.type === "install"
        ? "Установка в локальное хранилище · файлы не попадут в Git"
        : "Озвучка работает на этом Mac · готовую дорожку можно скачать";
}
async function watchJob() {
  if (!job) return;
  try {
    const j = await api("/api/jobs/" + job.id);
    job = j;
    showJob(j);
    if (j.status === "running") {
      pollTimer = setTimeout(watchJob, 1500);
      return;
    }
    const ended = j;
    job = null;
    busy(false);
    $("#job-progress").classList.add("hidden");
    state.stories = await api("/api/stories");
    renderLibrary();
    if (ended.type === "story") await accountUI.refresh();
    if (ended.status === "error") toast(ended.error, true);
    else if (ended.status === "cancelled")
      toast("Задача остановлена. Готовые варианты сохранены.");
    else if (ended.type === "install") {
      await settingsUI.refresh();
      toast("Установка завершена.");
    } else if (ended.type === "story") {
      const r = state.stories.find((r) => r.id === ended.results[0]);
      if (r) chooseStory(r);
      toast(`Готово. Сохранено вариантов: ${ended.results.length}.`);
    } else if (ended.audio) {
      if (ended.type === "audio" && current?.id === ended.storyId && !dirty) {
        current = state.stories.find((r) => r.id === current.id) || current;
        tab = "voice";
        renderEditor();
      }
      const target =
        page === "settings" ? $("#voice-preview-player") : $("#scene-preview");
      if (target) {
        const a = document.createElement("audio");
        a.controls = true;
        a.src = ended.audio.url;
        target.replaceChildren(a);
      }
      toast(ended.notice || "Озвучка готова.");
    }
  } catch (e) {
    toast("Связь со студией прервалась. Повторяем проверку…", true);
    pollTimer = setTimeout(watchJob, 5000);
  }
}
function startJob(j) {
  clearTimeout(pollTimer);
  job = j;
  busy(true);
  showJob(j);
  toast(
    j.type === "story"
      ? "Пишем историю: " + settingsUI.modelName()
      : j.type === "install"
        ? "Устанавливаем движок или модель."
        : "Готовим голос. Первый запуск может занять несколько минут.",
  );
  watchJob();
}
$("#cancel").onclick = safe(async () => {
  if (job) await api("/api/jobs/" + job.id, "DELETE");
});
// Keep task progress visible on every page.
$("header").after($("#job-progress"));
$("#job-progress").append($("#cancel"));
renderWorld();
settingsUI.render();
accountUI.render();
await refreshWorldList();
renderLibrary();
chooseStory(state.stories[0] || null);
if (state.active) startJob(state.active);
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  try {
    await document.modelContext.registerTool(
      {
        name: "list_cosmos_stories",
        description: "List saved local story titles and identifiers.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: async () => ({
          stories: (await api("/api/stories")).map((r) => ({
            id: r.id,
            title: r.title,
          })),
        }),
      },
      { signal: lifecycle.signal },
    );
  } catch {}
  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
}
async function refreshWorldList() {
  state.worlds = await api("/api/worlds");
  $("#world-select").innerHTML = state.worlds.worlds
    .map(
      (w) =>
        `<option value="${w.id}" ${w.id === state.worlds.currentId ? "selected" : ""}>${esc(w.name)} · ${w.characters} героев</option>`,
    )
    .join("");
}
async function changeWorld(w) {
  state.world = w;
  worldDraft = structuredClone(w);
  selected = [];
  heroPicker();
  renderWorld();
  await refreshWorldList();
  stashPrefs();
  toast("Вселенная открыта. Выбери героев для новой истории.");
}
$("#world-select").onchange = safe(async (e) => {
  await changeWorld(
    await api("/api/worlds/" + e.target.value + "/activate", "POST", {}),
  );
});
$("#new-world").onclick = safe(async () =>
  changeWorld(await api("/api/worlds", "POST", {})),
);
$("#import-world").onclick = () => $("#world-file").click();
$("#world-file").onchange = safe(async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 7000000) throw new Error("Файл мира больше 7 МБ.");
  const world = JSON.parse(await f.text());
  await changeWorld(await api("/api/worlds", "POST", { world }));
  e.target.value = "";
});
$("#world-editor").onchange = safe(async (e) => {
  if (e.target.dataset.portrait === undefined) return;
  const f = e.target.files[0];
  if (!f) return;
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(f.type) ||
    f.size > 10000000
  )
    throw new Error("Выбери PNG, JPEG или WebP до 10 МБ.");
  const url = URL.createObjectURL(f);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d"),
      size = Math.min(image.width, image.height);
    ctx.drawImage(
      image,
      (image.width - size) / 2,
      (image.height - size) / 2,
      size,
      size,
      0,
      0,
      256,
      256,
    );
    worldDraft.characters[+e.target.dataset.portrait].portraitData =
      canvas.toDataURL("image/jpeg", 0.85);
    renderWorld();
  } finally {
    URL.revokeObjectURL(url);
  }
});
