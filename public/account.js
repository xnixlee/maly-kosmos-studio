export function setupAccount({ $, state, api, esc, safe, toast }) {
  const usd = (n) => "$" + Number(n || 0).toFixed(6);
  async function refresh() {
    state.account = await api("/api/account");
    render();
  }
  function render() {
    const a = state.account,
      p = a.pricing.models["gpt-5.6-luna"];
    $("#account-editor").innerHTML =
      `<div class="settings-grid"><article class="panel"><span class="tag">API-КЛЮЧИ</span><h2 class="settings-title">Подключить OpenAI</h2><p class="muted">Ключ хранится на сервере этой локальной студии, в закрытой от Git папке. После сохранения браузер получает только последние четыре символа.</p><form id="key-form"><label>Название ключа<input id="key-name" maxlength="80" placeholder="Мои сценарии" required autocomplete="off"></label><label>API-ключ<input id="api-key" type="password" required autocomplete="new-password" spellcheck="false" placeholder="Ключ OpenAI"></label><button class="primary voice-actions">Сохранить ключ</button></form>${a.profiles.map((p) => `<div class="account-key"><strong>${esc(p.name)}</strong><span class="muted"> ${esc(p.hint)}${a.active === p.id ? " · используется" : ""}</span><p class="hint">${usd(p.usage.usd)} · ${p.usage.requests} запросов${p.usage.unknown ? " · неизвестная стоимость: " + p.usage.unknown : ""}</p><div class="actions"><button data-check-key="${p.id}">Проверить доступ</button>${a.active !== p.id ? `<button data-select-key="${p.id}">Использовать</button>` : ""}${!p.environment ? `<button class="text-button danger" data-remove-key="${p.id}">Удалить ключ</button>` : ""}</div></div>`).join("")}</article><article class="panel"><span class="tag">РАСХОДЫ ЭТОЙ СТУДИИ</span><div class="cost-total">${usd(a.usage.usd)}</div><p>${a.usage.requests} запросов · ${a.usage.inputTokens.toLocaleString("ru-RU")} входных / ${a.usage.outputTokens.toLocaleString("ru-RU")} выходных токенов</p>${a.usage.unknown ? `<p class="status-error">${a.usage.unknown} запросов без подтверждённой стоимости. Они не включены в сумму.</p>` : ""}<p class="muted">Расчёт в USD по usage ответов и сохранённому тарифу. Это не баланс аккаунта: траты других приложений сюда не попадают.</p><div class="continuity">gpt-5.6-luna · Standard<br>За миллион токенов: вход $${p.input}, кеш $${p.cachedInput}, запись кеша $${p.cacheWrite}, выход $${p.output}.<br>Тариф проверен ${a.pricing.verifiedAt}.</div><p><a href="${a.pricing.source}" target="_blank" rel="noreferrer">Тарифы OpenAI ↗</a> · <a href="https://platform.openai.com/usage" target="_blank" rel="noreferrer">Полный расход аккаунта ↗</a></p><button id="refresh-account">Обновить расходы</button></article></div><h2 class="character-heading">Последние запросы</h2><div class="usage-table-wrap"><table class="usage-table"><thead><tr><th>Время</th><th>Ключ / модель</th><th>Вход / выход</th><th>Статус</th><th>USD</th></tr></thead><tbody>${a.recent.map((r) => `<tr><td>${new Date(r.createdAt).toLocaleString("ru-RU")}</td><td>${esc(a.profiles.find((p) => p.id === r.accountId)?.name || r.accountId)}<br><span class="muted">${esc(r.model)}</span></td><td>${r.usage?.input_tokens ?? "—"} / ${r.usage?.output_tokens ?? "—"}</td><td>${esc({ pending: "В работе", completed: "Завершён", failed: "Ошибка API", unknown: "Стоимость неизвестна", incomplete: "Неполный ответ" }[r.status] || r.status)}</td><td>${r.cost ? usd(r.cost.usd) : "Не подтверждено"}</td></tr>`).join("") || '<tr><td colspan="5">Запросов пока нет. Проверка доступа не создаёт платную генерацию.</td></tr>'}</tbody></table></div>`;
    $("#key-form").onsubmit = safe(async (e) => {
      e.preventDefault();
      const key = $("#api-key").value,
        name = $("#key-name").value;
      $("#api-key").value = "";
      state.account = await api("/api/account/keys", "POST", { key, name });
      render();
      toast("Ключ сохранён. Выбери OpenAI в разделе моделей.");
    });
  }
  $("#account-editor").onclick = safe(async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.checkKey) {
      await api(
        "/api/account/keys/" + b.dataset.checkKey + "/check",
        "POST",
        {},
      );
      toast("gpt-5.6-luna доступна этому ключу.");
    }
    if (b.dataset.selectKey) {
      state.account = await api(
        "/api/account/keys/" + b.dataset.selectKey + "/activate",
        "POST",
        {},
      );
      render();
    }
    if (
      b.dataset.removeKey &&
      confirm("Удалить ключ из этой студии? Журнал расходов сохранится.")
    ) {
      state.account = await api(
        "/api/account/keys/" + b.dataset.removeKey,
        "DELETE",
      );
      render();
    }
    if (b.id === "refresh-account") await refresh();
  });
  return { render, refresh };
}
