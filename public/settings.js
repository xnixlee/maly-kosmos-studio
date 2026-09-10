export function setupSettings({
  $,
  state,
  api,
  esc,
  safe,
  toast,
  startJob,
  navigate,
}) {
  function modelName() {
    const c = state.models.text;
    return c.provider === "openai"
      ? "OpenAI · gpt-5.6-luna"
      : state.models.entries.find((m) => m.id === c.modelId)?.name ||
          "Выбери модель";
  }
  function note() {
    const cloud = state.models.text.provider === "openai";
    $("#engine-badge").textContent = modelName();
    $("#generation-note").textContent = cloud
      ? "Запрос, выбранные герои и лор отправятся в OpenAI. Стоимость — в кабинете."
      : "Текст и лор остаются на этом компьютере.";
    $("#temperature").disabled = cloud;
    $("#seed").disabled = cloud;
  }
  async function refresh() {
    state.models = await api("/api/models");
    state.voices = state.models.entries.filter(
      (m) => m.kind !== "mlx" && m.enabled,
    );
    render();
  }
  function render() {
    const m = state.models,
      c = m.text;
    $("#settings-editor").innerHTML =
      `<div class="settings-grid"><article class="panel"><span class="tag">ГЕНЕРАЦИЯ ИСТОРИЙ</span><h2 class="settings-title">Кто пишет сценарий</h2><label>Движок<select id="text-provider"><option value="mlx" ${c.provider === "mlx" ? "selected" : ""}>Локальный MLX · Apple Silicon</option><option value="openai" ${c.provider === "openai" ? "selected" : ""}>OpenAI · gpt-5.6-luna</option></select></label><label>Локальная модель<select id="text-model">${m.entries
        .filter((x) => x.kind === "mlx")
        .map(
          (x) =>
            `<option value="${x.id}" ${x.id === c.modelId ? "selected" : ""} ${x.enabled ? "" : "disabled"}>${esc(x.name)}${x.installed ? "" : " · не скачана"}</option>`,
        )
        .join(
          "",
        )}</select></label><label>Глубина рассуждения OpenAI<select id="reasoning">${["none", "low", "medium", "high", "xhigh", "max"].map((x) => `<option ${c.reasoning === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><p class="hint">Температура и зерно в форме относятся к локальной модели. Для OpenAI используется глубина рассуждения.</p><button id="save-engine" class="primary voice-actions">Использовать этот движок</button><p><button class="text-button" id="go-account">Добавить API-ключ в кабинете ↗</button></p></article><article class="panel"><span class="tag">УСТАНОВКА</span><h2 class="settings-title">Среда для локальных моделей</h2><p class="muted">Для OpenAI достаточно самого приложения. Локальные движки устанавливаются отдельно.</p><div class="actions"><button data-install-engine="text">Установить MLX</button><button data-install-engine="voice">Установить Silero</button><button data-install-engine="rvc">Установить RVC</button></div><p class="hint">MLX и RVC — Mac с Apple Silicon. Silero — Python 3.11–3.12. Модели скачиваются отдельными кнопками ниже.</p><details><summary>Подключить существующее окружение</summary><label>Python для текста<input id="text-python" value="${esc(m.textPython)}"></label><label>Python для озвучки<input id="voice-python" value="${esc(m.voice.python)}"></label><label>Папка голосовых моделей<input id="voice-assets" value="${esc(m.voice.assetsRoot)}"></label><label>Папка rvc-mlx<input id="voice-vendor" value="${esc(m.voice.vendor)}"></label><button id="save-runtime">Сохранить пути</button><p class="hint">Папка моделей содержит silero-v5-ru.pt и whisper/base.pt. Пути хранятся только на этом компьютере.</p></details></article></div><div class="section-head character-heading"><h2>Подключённые модели</h2><span class="muted">Веса не входят в Git</span></div><div class="model-grid">${m.entries.map((x) => `<article class="panel model-card"><div class="section-head"><div><span class="tag">${x.kind.toUpperCase()}</span><h3>${esc(x.name)}</h3></div><label class="toggle-label"><input type="checkbox" data-toggle-model="${x.id}" ${x.enabled ? "checked" : ""}> Вкл.</label></div><p class="model-status ${x.installed ? "" : "muted"}">${x.installed ? "Файлы готовы" : "Файлы не скачаны"}${x.size ? " · " + esc(x.size) : ""}</p><p class="hint">${x.installed ? (x.managed ? "В папке моделей студии" : "Внешняя модель · файлы останутся на месте") : "После установки движка скачай модель."}</p><div class="actions">${x.repo || x.kind === "silero" ? `<button data-install-model="${x.id}">${x.installed ? "Проверить загрузку" : "Скачать"}</button>` : ""}${x.managed && x.installed ? `<button class="text-button danger" data-delete-model="${x.id}">Удалить файлы</button>` : ""}${x.kind !== "mlx" ? `<button data-test-voice="${x.id}" ${!x.installed || !x.enabled ? "disabled" : ""}>▷ Голос</button>` : ""}</div>${x.source ? `<p class="hint"><a href="${esc(x.source)}" target="_blank" rel="noreferrer">Источник и условия ↗</a>${x.license ? " · " + esc(x.license) : ""}</p>` : ""}</article>`).join("")}</div><details class="panel custom-model"><summary>+ Подключить свою модель</summary><div class="two"><label>Название<input id="custom-model-name" maxlength="100"></label><label>Тип<select id="custom-model-kind"><option value="mlx">MLX · текст</option><option value="rvc">RVC · голос</option></select></label></div><label>Путь к уже скачанной модели<input id="custom-model-path" placeholder="Папка MLX или файл model.npz для RVC"></label><p class="muted">Или источник на Hugging Face для загрузки:</p><div class="two"><label>Репозиторий<input id="custom-model-repo" placeholder="автор/модель"></label><label>Commit · 40 символов<input id="custom-model-revision"></label></div><div class="two"><label>Файл .pth для RVC<input id="custom-model-file" placeholder="путь/к/модели.pth"></label><label>Базовая высота RVC<input id="custom-model-pitch" type="number" min="-24" max="24" value="0"></label></div><button id="add-model">Подключить модель</button><p class="hint">MLX использует safetensors без удалённого Python-кода. Условия использования весов определяет их автор.</p></details><div class="panel voice-sample-panel"><label>Фраза для пробы голоса<textarea id="voice-sample" maxlength="300" rows="2">Не закрывай калитку. Мы ещё не решили, где сегодня низ.</textarea></label><div id="voice-preview-player"></div></div>`;
    note();
  }
  $("#settings-editor").onchange = safe(async (e) => {
    const t = e.target;
    if (t.dataset.toggleModel) {
      try {
        await api("/api/models/" + t.dataset.toggleModel, "PUT", {
          enabled: t.checked,
        });
      } finally {
        await refresh();
      }
    }
  });
  $("#settings-editor").onclick = safe(async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "save-engine") {
      state.models = await api("/api/models/settings", "PUT", {
        text: {
          provider: $("#text-provider").value,
          modelId: $("#text-model").value,
          reasoning: $("#reasoning").value,
        },
      });
      note();
      toast("Текстовый движок выбран.");
    }
    if (b.id === "go-account") navigate("account");
    if (b.id === "save-runtime") {
      await api("/api/models/settings", "PUT", {
        textPython: $("#text-python").value,
        voice: {
          python: $("#voice-python").value,
          assetsRoot: $("#voice-assets").value,
          vendor: $("#voice-vendor").value,
        },
      });
      await refresh();
      toast("Пути сохранены.");
    }
    if (b.dataset.installEngine)
      startJob(
        await api("/api/engines/install", "POST", {
          kind: b.dataset.installEngine,
        }),
      );
    if (b.dataset.installModel)
      startJob(
        await api(
          "/api/models/" + b.dataset.installModel + "/install",
          "POST",
          {},
        ),
      );
    if (
      b.dataset.deleteModel &&
      confirm(
        "Удалить скачанные файлы модели из папки студии? Её можно скачать заново.",
      )
    ) {
      await api("/api/models/" + b.dataset.deleteModel + "/files", "DELETE");
      await refresh();
    }
    if (b.id === "add-model") {
      await api("/api/models", "POST", {
        name: $("#custom-model-name").value,
        kind: $("#custom-model-kind").value,
        path: $("#custom-model-path").value,
        repo: $("#custom-model-repo").value,
        revision: $("#custom-model-revision").value,
        filename: $("#custom-model-file").value,
        pitch: Number($("#custom-model-pitch").value),
      });
      await refresh();
      toast("Модель добавлена.");
    }
    if (b.dataset.testVoice)
      startJob(
        await api("/api/voice-preview", "POST", {
          text: $("#voice-sample").value,
          voice: b.dataset.testVoice,
          speed: 1,
          pitch: 0,
        }),
      );
  });
  return { render, refresh, modelName };
}
