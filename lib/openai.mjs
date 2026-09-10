import path from "node:path";
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { readJSON, writeJSON, serial } from "./storage.mjs";
import { bad } from "./stories.mjs";
const fingerprint = (key) =>
  createHash("sha256").update(key).digest("hex").slice(0, 16);
export function calculateCost(usage, rate, tier = "default") {
  if (
    !usage ||
    !rate ||
    !Number.isSafeInteger(usage.input_tokens) ||
    !Number.isSafeInteger(usage.output_tokens)
  )
    return null;
  const input = usage.input_tokens,
    output = usage.output_tokens,
    cached = usage.input_tokens_details?.cached_tokens ?? 0,
    write = usage.input_tokens_details?.cache_write_tokens ?? 0;
  if (
    [input, output, cached, write].some(
      (x) => !Number.isSafeInteger(x) || x < 0,
    ) ||
    cached + write > input
  )
    return null;
  const long = input > rate.longContextThreshold;
  const prices = long
    ? [
        rate.longInput,
        rate.longCachedInput,
        rate.longCacheWrite,
        rate.longOutput,
      ]
    : [rate.input, rate.cachedInput, rate.cacheWrite, rate.output];
  if (prices.some((x) => !Number.isFinite(x) || x < 0)) return null;
  const multiplier = { default: 1, auto: 1, priority: 2, fast: 2, flex: 0.5 }[
    tier
  ];
  if (multiplier === undefined) return null;
  const nanoUSD = Math.round(
    ((input - cached - write) * prices[0] +
      cached * prices[1] +
      write * prices[2] +
      output * prices[3]) *
      1000 *
      multiplier,
  );
  return {
    nanoUSD,
    usd: nanoUSD / 1e9,
    input,
    output,
    cached,
    cacheWrite: write,
    ordinaryInput: input - cached - write,
    longContext: long,
  };
}
export function storySchema(speakers) {
  const scene = {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      ["speaker", "text", "visual", "sound", "imagePrompt"].map((k) => [
        k,
        k === "speaker"
          ? { type: "string", enum: speakers }
          : { type: "string" },
      ]),
    ),
    required: ["speaker", "text", "visual", "sound", "imagePrompt"],
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      logline: { type: "string" },
      continuity: { type: "string" },
      scenes: { type: "array", minItems: 1, maxItems: 15, items: scene },
    },
    required: ["title", "logline", "continuity", "scenes"],
  };
}
export class OpenAIService {
  constructor(root, data, fetcher = fetch, env = process.env) {
    this.root = root;
    this.data = data;
    this.fetcher = fetcher;
    this.env = env;
    this.lock = serial();
    this.controller = null;
  }
  async load() {
    this.pricing = await readJSON(
      path.join(this.root, "config/pricing.json"),
      {},
    );
    this.accounts = await readJSON(path.join(this.data, "accounts.json"), {
      active: null,
      profiles: [],
    });
    this.ledger = await readJSON(path.join(this.data, "usage.json"), []);
    for (const x of this.ledger)
      if (x.status === "pending") x.status = "unknown";
    await this.saveLedger();
  }
  async saveLedger() {
    await writeJSON(path.join(this.data, "usage.json"), this.ledger);
  }
  async key(id = this.accounts.active) {
    if (!id && this.env.OPENAI_API_KEY)
      id = "env-" + fingerprint(this.env.OPENAI_API_KEY);
    if (id?.startsWith("env-") && this.env.OPENAI_API_KEY)
      return this.env.OPENAI_API_KEY;
    if (!id) throw bad("Сначала добавь API-ключ в кабинете.", 400);
    const secret = await readJSON(
      path.join(this.data, "secrets", id + ".json"),
      null,
    );
    if (!secret?.key) throw bad("API-ключ не найден. Подключи его в кабинете.");
    return secret.key;
  }
  async view() {
    const profiles = [...this.accounts.profiles];
    if (this.env.OPENAI_API_KEY) {
      const key = this.env.OPENAI_API_KEY;
      profiles.push({
        id: "env-" + fingerprint(key),
        name: "OPENAI_API_KEY",
        hint: "••••" + key.slice(-4),
        environment: true,
      });
      if (!this.accounts.active) this.accounts.active = profiles.at(-1).id;
    }
    const rows = this.ledger.slice().reverse();
    const summarize = (id) => {
      const entries = this.ledger.filter((x) => !id || x.accountId === id);
      const nanoUSD = entries.reduce((n, x) => n + (x.cost?.nanoUSD || 0), 0);
      return {
        usd: nanoUSD / 1e9,
        requests: entries.length,
        inputTokens: entries.reduce(
          (n, x) => n + (x.usage?.input_tokens || 0),
          0,
        ),
        outputTokens: entries.reduce(
          (n, x) => n + (x.usage?.output_tokens || 0),
          0,
        ),
        unknown: entries.filter(
          (x) =>
            x.cost === null &&
            ["unknown", "pending", "completed", "incomplete"].includes(
              x.status,
            ),
        ).length,
      };
    };
    return {
      active: this.accounts.active,
      profiles: profiles.map((p) => ({ ...p, usage: summarize(p.id) })),
      usage: summarize(),
      recent: rows.slice(0, 50),
      pricing: this.pricing,
    };
  }
  async add({ name, key }) {
    if (
      typeof key !== "string" ||
      key.length < 20 ||
      key.length > 512 ||
      /\s/.test(key) ||
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 80
    )
      throw bad("Укажи название и API-ключ без пробелов.");
    const id = fingerprint(key);
    await this.lock(async () => {
      await writeJSON(path.join(this.data, "secrets", id + ".json"), { key });
      this.accounts.profiles = this.accounts.profiles.filter(
        (p) => p.id !== id,
      );
      this.accounts.profiles.push({
        id,
        name: name.trim(),
        hint: "••••" + key.slice(-4),
      });
      this.accounts.active = id;
      await writeJSON(path.join(this.data, "accounts.json"), this.accounts);
    });
    return this.view();
  }
  async select(id) {
    if (!(await this.view()).profiles.some((p) => p.id === id))
      throw bad("Ключ не найден.");
    this.accounts.active = id;
    await writeJSON(path.join(this.data, "accounts.json"), this.accounts);
    return this.view();
  }
  async remove(id) {
    if (!this.accounts.profiles.some((p) => p.id === id))
      throw bad("Ключ не найден.");
    await this.lock(async () => {
      await fs.rm(path.join(this.data, "secrets", id + ".json"), {
        force: true,
      });
      this.accounts.profiles = this.accounts.profiles.filter(
        (p) => p.id !== id,
      );
      if (this.accounts.active === id)
        this.accounts.active = this.accounts.profiles[0]?.id || null;
      await writeJSON(path.join(this.data, "accounts.json"), this.accounts);
    });
    return this.view();
  }
  async check(id) {
    const key = await this.key(id);
    const response = await this.fetcher(
      "https://api.openai.com/v1/models/gpt-5.6-luna",
      {
        headers: { Authorization: "Bearer " + key },
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      },
    );
    if (!response.ok)
      throw bad(
        response.status === 401
          ? "OpenAI отклонил ключ."
          : response.status === 404
            ? "Этому ключу недоступна gpt-5.6-luna."
            : "Не удалось проверить доступ к OpenAI: HTTP " + response.status,
        400,
      );
    return { available: true, model: "gpt-5.6-luna" };
  }
  stop() {
    this.controller?.abort();
  }
  async generate(
    { messages, speakers, model = "gpt-5.6-luna", reasoning = "medium", jobId },
    onStage = () => {},
  ) {
    if (model !== "gpt-5.6-luna")
      throw bad("Для OpenAI сейчас настроена gpt-5.6-luna.");
    await this.view();
    const accountId = this.accounts.active,
      key = await this.key(accountId);
    const row = {
      id: randomUUID(),
      accountId,
      model,
      jobId,
      createdAt: new Date().toISOString(),
      status: "pending",
      usage: null,
      cost: null,
      pricingSnapshot: this.pricing.models[model],
      pricingDate: this.pricing.verifiedAt,
    };
    await this.lock(async () => {
      this.ledger.push(row);
      await this.saveLedger();
    });
    const controller = new AbortController();
    this.controller = controller;
    try {
      onStage("OpenAI пишет сценарий…");
      const response = await this.fetcher(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + key,
          },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(240000),
          ]),
          body: JSON.stringify({
            model,
            input: messages,
            store: false,
            service_tier: "default",
            reasoning: { effort: reasoning },
            max_output_tokens: 8000,
            text: {
              format: {
                type: "json_schema",
                name: "cosmos_story",
                strict: true,
                schema: storySchema(speakers),
              },
            },
          }),
        },
      );
      if (!response.ok) {
        row.status = "failed";
        row.httpStatus = response.status;
        throw new Error(
          response.status === 401
            ? "OpenAI отклонил API-ключ."
            : response.status === 429
              ? "OpenAI: лимит запросов или бюджета. Проверь кабинет OpenAI."
              : "OpenAI вернул HTTP " +
                response.status +
                ". Запрос автоматически не повторялся.",
        );
      }
      const data = await response.json();
      row.responseId = data.id;
      row.status = data.status || "completed";
      row.usage = data.usage || null;
      row.serviceTier = data.service_tier || "default";
      row.cost = calculateCost(row.usage, row.pricingSnapshot, row.serviceTier);
      await this.lock(() => this.saveLedger());
      if (data.status !== "completed")
        throw new Error(
          "OpenAI не завершил сценарий. Полученное потребление учтено.",
        );
      const content = data.output?.flatMap((o) => o.content || []) || [];
      if (content.some((c) => c.type === "refusal"))
        throw new Error("OpenAI отказался от этого запроса. Измени завязку.");
      const text = content
        .filter((c) => c.type === "output_text")
        .map((c) => c.text)
        .join("");
      if (!text)
        throw new Error("OpenAI вернул пустой текст. Потребление учтено.");
      return { text, usageId: row.id, cost: row.cost };
    } catch (e) {
      if (row.status === "pending") row.status = "unknown";
      throw e;
    } finally {
      await this.lock(() => this.saveLedger());
      if (this.controller === controller) this.controller = null;
    }
  }
}
