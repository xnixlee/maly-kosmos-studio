export function setupCreative({
  $,
  api,
  esc,
  safe,
  toast,
  startJob,
  navigate,
  state,
  saveWorld,
  getCurrent,
  worldSection,
  saveStory,
  refreshStory,
  onAccepted,
}) {
  const fields = {
    name: "Имя",
    role: "Роль в мире",
    appearance: "Внешность и силуэт",
    personality: "Характер и противоречие",
    desire: "Чего хочет",
    flaw: "Слабость",
    habits: "Повадки и манера речи",
    relationships: "Связи с жителями",
    hooks: "Завязки с героем",
    canon: "Связь с законами мира",
    imagePrompt: "Промпт портрета",
  };
  const limits = {
    name: 80,
    role: 150,
    appearance: 500,
    personality: 400,
    desire: 300,
    flaw: 300,
    habits: 300,
    relationships: 500,
    hooks: 400,
    canon: 400,
    imagePrompt: 1800,
  };
  const types = {
    story: "Истории",
    idea: "Идея для истории",
    audio: "Озвучка истории",
    preview: "Проба голоса",
    install: "Установка",
    character: "Новый персонаж",
    images: "Кадры истории",
  };
  const statuses = {
    running: "В работе",
    done: "Готово",
    error: "Ошибка",
    cancelled: "Остановлено",
  };
  let taskSignature = null;
  let draft = null,
    reviewJob = null;
  const elapsed = (j) => {
    if (j.status !== "running" && !j.finishedAt) return "время не записано";
    const seconds = Math.max(
      0,
      Math.floor(
        ((j.finishedAt ? Date.parse(j.finishedAt) : Date.now()) -
          Date.parse(j.createdAt)) /
          1000,
      ),
    );
    return seconds >= 60
      ? `${Math.floor(seconds / 60)} мин ${seconds % 60} сек`
      : `${seconds} сек`;
  };
  function progress(j) {
    const p = j.progress;
    return `${j.itemLabel ? j.itemLabel + " · " : ""}${p ? `${p.completed} из ${p.total} ${p.label} · ` : ""}${elapsed(j)}`;
  }
  function imageSettings() {
    const { settings: s, models } = state.imageSettings;
    $("#image-settings-editor").innerHTML =
      `<article class="panel image-settings"><span class="tag">ИЗОБРАЖЕНИЯ</span><h2>Модель для кадров и портретов</h2><div class="three"><label>Модель OpenAI<select id="image-model">${models.map((m) => `<option ${m === s.model ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></label><label>Качество<select id="image-quality">${Object.entries(
        {
          low: "Черновое",
          medium: "Сбалансированное",
          high: "Высокое",
          xhigh: "Очень высокое",
          max: "Максимальное",
        },
      )
        .map(
          ([v, l]) =>
            `<option value="${v}" ${s.quality === v ? "selected" : ""}>${l}</option>`,
        )
        .join(
          "",
        )}</select></label><label>Формат кадров<select id="image-size">${Object.entries(
        {
          "1536x1024": "Альбомный · 3:2",
          "1024x1024": "Квадрат · 1:1",
          "1024x1536": "Вертикальный · 2:3",
        },
      )
        .map(
          ([v, l]) =>
            `<option value="${v}" ${s.size === v ? "selected" : ""}>${l}</option>`,
        )
        .join(
          "",
        )}</select></label></div><label>Общее художественное направление<textarea id="image-style" rows="3" maxlength="2000" placeholder="Материалы, палитра, свет, техника — в дополнение к лору">${esc(s.style)}</textarea></label><div class="actions"><button id="save-image-settings">Сохранить настройки изображений</button><button data-page="account" class="text-button">Ключ и расходы ↗</button></div><p class="hint">Flare — повседневная генерация; Sunburst — точное следование референсам. Портреты рисуются квадратными. Лор, описания героев и прикреплённые портреты отправляются в OpenAI. Веса не нужны. Точная стоимость появится после ответа API.</p></article>`;
    $("#save-image-settings").onclick = safe(async () => {
      state.imageSettings = await api("/api/image-settings", "PUT", {
        provider: "openai",
        model: $("#image-model").value,
        quality: $("#image-quality").value,
        size: $("#image-size").value,
        style: $("#image-style").value,
      });
      toast("Модель изображений настроена.");
    });
  }
  function generator() {
    $("#character-generator").innerHTML =
      `<article class="panel character-builder"><h2>Новый персонаж</h2><p class="muted">Опиши идею. Модель учтёт текущий лор, придумает характер и связи с жителями.</p><label>Кто нужен этой вселенной?<textarea id="character-brief" maxlength="2500" rows="3" placeholder="Сосед, который ремонтирует чужую гравитацию, а дома всё время падает с потолка…"></textarea></label><label class="toggle-label"><input type="checkbox" id="character-with-portrait" checked> Добавить портрет · платный запрос OpenAI</label><div class="actions"><button id="generate-character" class="primary">Создать персонажа</button><button data-page="settings" class="text-button">Выбрать модели ↗</button></div><p class="hint">Перед запуском лор сохранится. Готовую карточку можно отредактировать, прежде чем добавить героя в мир.</p><div id="character-review"></div></article>`;
    $("#generate-character").onclick = safe(async () => {
      const brief = $("#character-brief").value.trim();
      if (!brief) throw new Error("Опиши, какого персонажа хочется.");
      await saveWorld();
      startJob(
        await api("/api/characters/generate", "POST", {
          brief,
          portrait: $("#character-with-portrait").checked,
        }),
      );
    });
  }
  async function thumbnail(url) {
    const im = new Image();
    im.src = url;
    await im.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#e0ddd4";
    ctx.fillRect(0, 0, 256, 256);
    const k = Math.min(256 / im.width, 256 / im.height);
    ctx.drawImage(
      im,
      (256 - im.width * k) / 2,
      (256 - im.height * k) / 2,
      im.width * k,
      im.height * k,
    );
    return c.toDataURL("image/jpeg", 0.86);
  }
  function renderReview() {
    const j = reviewJob;
    $("#character-review").innerHTML =
      `<div class="character-review"><div class="section-head"><h3>${j.accepted ? "Герой добавлен" : "Новый житель · черновик"}</h3><span class="muted">${esc(j.worldName)}</span></div>${j.portrait ? `<a href="${esc(j.portrait.url)}" download><img class="generated-portrait" src="${esc(j.portrait.url)}" alt="Портрет персонажа"></a>` : '<p class="hint">Портрет не создан. Карточку можно добавить без него.</p>'}<div class="two">${Object.entries(
        fields,
      )
        .filter(([k]) =>
          ["name", "role", "appearance", "personality"].includes(k),
        )
        .map(
          ([k, l]) =>
            `<label>${l}<textarea data-draft-field="${k}" maxlength="${limits[k]}" rows="${["name", "role"].includes(k) ? 1 : 3}">${esc(draft[k])}</textarea></label>`,
        )
        .join(
          "",
        )}</div><details class="character-depth"><summary>Желания, повадки и связи</summary><div class="two">${Object.entries(
        fields,
      )
        .filter(
          ([k]) =>
            ![
              "name",
              "role",
              "appearance",
              "personality",
              "imagePrompt",
            ].includes(k),
        )
        .map(
          ([k, l]) =>
            `<label>${l}<textarea data-draft-field="${k}" maxlength="${limits[k]}" rows="3">${esc(draft[k])}</textarea></label>`,
        )
        .join(
          "",
        )}</div></details><details class="character-depth"><summary>Настроить промпт портрета</summary><label>Описание для изображения<textarea data-draft-field="imagePrompt" maxlength="1800" rows="4">${esc(draft.imagePrompt)}</textarea></label></details><label>Голос<select id="draft-voice">${[...new Set([draft.voice, ...state.voices.map((v) => v.id)])].map((v) => `<option value="${esc(v)}" ${v === draft.voice ? "selected" : ""}>${esc(state.voices.find((x) => x.id === v)?.name || v)}</option>`).join("")}</select></label><div class="actions"><button id="redraw-character">${j.portrait ? "Перерисовать портрет" : "Нарисовать портрет"} · OpenAI</button><button id="preview-character">▷ Послушать голос</button><button id="accept-character" class="primary" ${j.accepted ? "disabled" : ""}>Добавить в «${esc(j.worldName)}»</button>${j.portrait ? `<a href="${esc(j.portrait.url)}" download>Скачать портрет PNG</a>` : ""}</div><div id="character-preview-player"></div><p class="hint">Все детали попадут в редактируемое описание героя. Проверь связи и соответствие канону перед добавлением. Сохранённые истории сохраняют свой состав героев.</p></div>`;
    $("#character-review").oninput = (e) => {
      if (e.target.dataset.draftField)
        draft[e.target.dataset.draftField] = e.target.value;
      if (e.target.id === "draft-voice") draft.voice = e.target.value;
      try {
        localStorage.setItem(
          "cosmos-character-draft-" + j.id,
          JSON.stringify(draft),
        );
      } catch {}
    };
    $("#redraw-character").onclick = safe(async () => {
      startJob(
        await api(`/api/characters/${j.id}/portrait`, "POST", {
          character: draft,
        }),
      );
    });
    $("#preview-character").onclick = safe(async () => {
      startJob(
        await api("/api/voice-preview", "POST", {
          voice: draft.voice,
          text: draft.habits.slice(0, 280),
          speed: 1,
          pitch: 0,
        }),
      );
    });
    $("#accept-character").onclick = safe(async () => {
      const portraitData = j.portrait
        ? await thumbnail(j.portrait.url)
        : undefined;
      const result = await api(`/api/characters/${j.id}/accept`, "POST", {
        character: draft,
        portraitData,
      });
      j.accepted = true;
      await onAccepted(result.world, result.character);
      renderReview();
      await refreshTasks();
      toast("Персонаж добавлен в " + j.worldName + ".");
    });
  }
  async function showCharacter(j) {
    reviewJob = j;
    draft = structuredClone(j.character);
    try {
      const saved = JSON.parse(
        localStorage.getItem("cosmos-character-draft-" + j.id),
      );
      if (saved && typeof saved === "object") draft = { ...draft, ...saved };
    } catch {}
    navigate("world");
    worldSection("create");
    renderReview();
    $("#character-review").scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
  async function refreshTasks() {
    const data = await api("/api/jobs");
    state.jobs = data.jobs;
    $("#tasks-count").textContent = data.active ? "1" : "";
    const signature = JSON.stringify(data.jobs);
    if (signature === taskSignature) {
      for (const j of data.jobs) {
        const el = document.querySelector(`[data-task-clock="${j.id}"]`);
        if (el)
          el.textContent =
            progress(j) + " · " + new Date(j.createdAt).toLocaleString("ru-RU");
      }
      return data;
    }
    taskSignature = signature;
    $("#tasks-list").innerHTML =
      data.jobs
        .map(
          (j) =>
            `<article class="panel task-card"><div class="section-head"><h3>${types[j.type] || esc(j.type)}</h3><span class="tag ${j.status === "error" ? "status-error" : ""}">${statuses[j.status] || esc(j.status)}</span></div>${j.status === "running" ? `<p>${esc(j.stage)}</p>` : ""}<p class="muted" data-task-clock="${j.id}">${esc(progress(j))} · ${new Date(j.createdAt).toLocaleString("ru-RU")}</p>${j.progress && j.status === "running" ? `<progress max="${j.progress.total}" value="${j.progress.completed}" aria-label="Готовые части задачи"></progress>` : j.status === "running" ? '<progress aria-label="Выполняется"></progress>' : ""}${j.error ? `<p class="status-error">${esc(j.error)}</p>` : ""}${j.notice ? `<p class="hint">${esc(j.notice)}</p>` : ""}${j.idea ? `<p class="idea-result">${esc(j.idea)}</p>` : ""}<div class="actions">${j.idea ? `<button data-copy-idea="${j.id}">Копировать идею</button>` : ""}${j.status === "running" ? `<button data-cancel-task="${j.id}">Остановить</button>` : ""}${j.character && j.status !== "running" ? `<button data-review-character="${j.id}">${j.accepted ? "Посмотреть героя" : "Открыть карточку"}</button>` : ""}${j.storyId || (j.type === "story" && j.results?.length) ? `<button data-open-result="${esc(j.storyId || j.results[0])}">Открыть историю</button>` : ""}${j.audio ? `<audio controls src="${esc(j.audio.url)}"></audio><a href="${esc(j.audio.url)}" download>Скачать WAV</a>` : ""}</div>${j.images?.length ? `<details class="task-results"><summary>Изображения · ${j.images.length}</summary><div class="task-images">${j.images.map((a) => `<a href="${esc(a.url)}" download title="Скачать PNG"><img src="${esc(a.url)}" alt="Готовое изображение" loading="lazy"></a>`).join("")}</div></details>` : ""}</article>`,
        )
        .join("") ||
      '<p class="muted">Здесь появятся сценарии, кадры, персонажи, озвучка и установки.</p>';
    return data;
  }
  $("#tasks-list").onclick = safe(async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.copyIdea) {
      const j = await api("/api/jobs/" + b.dataset.copyIdea);
      await navigator.clipboard.writeText(j.idea);
      toast("Идея скопирована.");
    }
    if (b.dataset.cancelTask) {
      await api("/api/jobs/" + b.dataset.cancelTask, "DELETE");
      await refreshTasks();
    }
    if (b.dataset.reviewCharacter)
      await showCharacter(await api("/api/jobs/" + b.dataset.reviewCharacter));
    if (b.dataset.openResult) await refreshStory(b.dataset.openResult, true);
  });
  function shots(s, i, record) {
    const assets = (record.images || []).filter((a) => a.sceneIndex === i);
    const matches = assets.filter(
      (a) => JSON.stringify(a.scene) === JSON.stringify(s),
    );
    const a = matches.at(-1) || assets.at(-1),
      stale = a && !matches.length;
    return `<div class="scene-images">${a ? `<a href="${esc(a.url)}" download><img class="generated-frame" src="${esc(a.url)}" alt="Кадр ${i + 1}" loading="lazy"></a>${stale ? '<p class="hint">Этот кадр создан до правок сцены. Можно нарисовать новый.</p>' : ""}<div class="actions"><a href="${esc(a.url)}" download>Скачать PNG</a><span class="muted">${esc(a.model)} · ${a.cost ? "$" + a.cost.usd.toFixed(5) : "Стоимость не подтверждена"}</span></div>` : `<div class="frame-placeholder"><span aria-hidden="true">▧</span><p>${esc(s.visual || "Изображение этой сцены ещё не создано")}</p></div>`}<button data-generate-frame="${i}">${a ? "Новый вариант кадра" : "Нарисовать кадр"}</button>${assets.length > 1 ? `<details><summary>Предыдущие варианты · ${assets.length}</summary><div class="task-images">${assets.map((a) => `<a href="${esc(a.url)}" download><img src="${esc(a.url)}" alt="Вариант кадра" loading="lazy"></a>`).join("")}</div></details>` : ""}</div>`;
  }
  async function generateFrames(indices) {
    await saveStory(true);
    const r = getCurrent();
    startJob(
      await api("/api/stories/" + r.id + "/images", "POST", {
        scenes: indices,
      }),
    );
  }
  imageSettings();
  generator();
  return { progress, refreshTasks, showCharacter, shots, generateFrames };
}
