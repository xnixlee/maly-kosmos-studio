import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readJSON, writeJSON, exists, pythonIn, serial } from "./storage.mjs";
import { bad } from "./stories.mjs";
export class ModelManager {
  constructor(root, data, models) {
    Object.assign(this, {
      root,
      data,
      models,
      lock: serial(),
      installer: null,
    });
  }
  async load() {
    this.catalog = await readJSON(
      path.join(this.root, "config/catalog.json"),
      {},
    );
    const defaults = {
      text: { provider: "mlx", modelId: "qwen3-4b", reasoning: "medium" },
      textPython: pythonIn(path.join(this.root, ".venv")),
      voice: {
        python: pythonIn(path.join(this.root, ".venv-neural")),
        assetsRoot: path.join(this.models, "voice"),
        vendor: path.join(this.root, "vendor/rvc-mlx"),
      },
      entries: [...this.catalog.text, ...this.catalog.voice].map((m) => ({
        ...m,
        enabled: true,
        path:
          m.kind === "mlx"
            ? path.join(this.models, m.id)
            : m.kind === "rvc"
              ? path.join(this.models, "voice", m.id, "model.npz")
              : null,
      })),
    };
    this.config = await readJSON(
      path.join(this.data, "connections.json"),
      defaults,
    );
    await this.save();
  }
  save() {
    return writeJSON(path.join(this.data, "connections.json"), this.config);
  }
  get(id) {
    const m = this.config.entries.find((m) => m.id === id);
    if (!m) throw bad("Модель не найдена.", 404);
    return m;
  }
  async available(m) {
    if (m.kind === "mlx")
      return (
        (await exists(path.join(m.path, "config.json"))) &&
        (await exists(path.join(m.path, "tokenizer_config.json"))) &&
        (await fs.readdir(m.path).catch(() => [])).some((n) =>
          n.endsWith(".safetensors"),
        )
      );
    const a = this.config.voice.assetsRoot;
    const base =
      (await exists(path.join(a, "silero-v5-ru.pt"))) &&
      (await exists(path.join(a, "whisper/base.pt")));
    return (
      base &&
      (m.kind === "silero" ||
        ((await exists(m.path)) &&
          (await exists(m.path.replace(/\.npz$/, ".json"))) &&
          (await exists(
            path.join(
              this.config.voice.vendor,
              "rvc_mlx/models/predictors/rmvpe_mlx.npz",
            ),
          )) &&
          (await exists(
            path.join(
              this.config.voice.vendor,
              "rvc_mlx/models/embedders/contentvec/hubert_mlx.npz",
            ),
          ))))
    );
  }
  async owned(m) {
    if (!m.path) return false;
    const expected =
      m.kind === "mlx"
        ? path.join(this.models, m.id)
        : m.kind === "rvc"
          ? path.join(this.models, "voice", m.id, "model.npz")
          : null;
    if (!expected || path.resolve(m.path) !== path.resolve(expected))
      return false;
    const target = m.kind === "rvc" ? path.dirname(m.path) : m.path;
    const resolved = await fs
      .realpath(target)
      .catch(() => path.resolve(target));
    const base = await fs
      .realpath(this.models)
      .catch(() => path.resolve(this.models));
    return resolved.startsWith(base + path.sep);
  }
  async view() {
    const entries = await Promise.all(
      this.config.entries.map(async (m) => ({
        ...m,
        installed: await this.available(m),
        managed: await this.owned(m),
      })),
    );
    return {
      entries,
      text: this.config.text,
      textPython: this.config.textPython,
      voice: this.config.voice,
      platform: process.platform,
      arch: process.arch,
      textRuntime: await exists(this.config.textPython),
      voiceRuntime: await exists(this.config.voice.python),
      modelsDirectory: this.models,
    };
  }
  async voices() {
    return (await this.view()).entries.filter(
      (m) => m.kind !== "mlx" && m.enabled,
    );
  }
  async update(input) {
    await this.lock(async () => {
      if (input.text) {
        const t = input.text;
        if (
          !["mlx", "openai"].includes(t.provider) ||
          !["none", "low", "medium", "high", "xhigh", "max"].includes(
            t.reasoning,
          )
        )
          throw bad("Выбери текстовый движок и глубину рассуждения.");
        if (
          t.provider === "mlx" &&
          (!this.get(t.modelId).enabled || this.get(t.modelId).kind !== "mlx")
        )
          throw bad("Выбери подключённую текстовую модель.");
        this.config.text = {
          provider: t.provider,
          modelId: t.provider === "openai" ? "gpt-5.6-luna" : t.modelId,
          reasoning: t.reasoning,
        };
      }
      if (input.textPython) {
        if (
          !path.isAbsolute(input.textPython) ||
          !(await exists(input.textPython))
        )
          throw bad("Не найден Python для текста.");
        this.config.textPython = input.textPython;
      }
      if (input.voice) {
        for (const k of ["python", "assetsRoot", "vendor"])
          if (
            typeof input.voice[k] !== "string" ||
            !path.isAbsolute(input.voice[k])
          )
            throw bad("Пути голосового движка должны быть абсолютными.");
        this.config.voice = { ...input.voice };
      }
      await this.save();
    });
    return this.view();
  }
  async add(input) {
    const { name, kind } = input;
    if (
      !["mlx", "rvc"].includes(kind) ||
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 100
    )
      throw bad("Укажи тип и имя модели.");
    const id = "custom-" + randomUUID().slice(0, 8);
    const m = {
      id,
      name: name.trim(),
      kind,
      enabled: true,
      custom: true,
      note: "Своя модель",
    };
    if (input.path) {
      if (!path.isAbsolute(input.path) || !(await exists(input.path)))
        throw bad("Укажи существующий абсолютный путь.");
      if (kind === "rvc" && !input.path.endsWith(".npz"))
        throw bad(
          "Для локального RVC нужен конвертированный model.npz и соседний model.json.",
        );
      m.path = input.path;
    } else {
      if (
        !/^[\w.-]+\/[\w.-]+$/.test(input.repo || "") ||
        input.repo.includes("..")
      )
        throw bad("Нужен Hugging Face ID вида автор/модель.");
      if (!/^[a-f0-9]{40}$/.test(input.revision || ""))
        throw bad(
          "Для воспроизводимой загрузки укажи полный commit модели на Hugging Face (40 символов).",
        );
      m.repo = input.repo;
      m.revision = input.revision;
      m.source = "https://huggingface.co/" + input.repo;
      m.path =
        kind === "mlx"
          ? path.join(this.models, id)
          : path.join(this.models, "voice", id, "model.npz");
      if (kind === "rvc") {
        if (
          typeof input.filename !== "string" ||
          !input.filename.endsWith(".pth") ||
          input.filename.includes("..") ||
          path.isAbsolute(input.filename)
        )
          throw bad("Укажи путь к .pth в репозитории модели.");
        m.filename = input.filename;
      }
    }
    if (kind === "rvc") {
      m.speaker = "eugene";
      m.pitch = Number(input.pitch ?? 0);
      if (!Number.isFinite(m.pitch) || m.pitch < -24 || m.pitch > 24)
        throw bad("Базовая высота RVC: от −24 до 24.");
    }
    await this.lock(async () => {
      this.config.entries.push(m);
      await this.save();
    });
    return this.view();
  }
  async toggle(id, enabled) {
    if (typeof enabled !== "boolean")
      throw bad("Нужен переключатель подключения.");
    await this.lock(async () => {
      this.get(id).enabled = enabled;
      await this.save();
    });
    return this.view();
  }
  async removeFiles(id) {
    const m = this.get(id);
    if (!(await this.owned(m)))
      throw bad(
        "Это внешняя модель. Можно отключить подключение; её файлы студия не удаляет.",
      );
    const dest = m.kind === "rvc" ? path.dirname(m.path) : m.path;
    await fs.rm(dest, { recursive: true, force: true });
    return this.view();
  }
  cancelInstall() {
    if (this.installer) {
      try {
        if (process.platform === "win32")
          spawn("taskkill", ["/pid", String(this.installer.pid), "/T", "/F"]);
        else process.kill(-this.installer.pid, "SIGTERM");
      } catch {
        this.installer.kill();
      }
    }
  }
  async install(kind, id, onStage) {
    if (this.installer) throw bad("Установка уже идёт.", 409);
    let spec;
    if (kind === "model") {
      const m = this.get(id);
      if (!m.repo && m.kind !== "silero")
        throw bad("У внешней модели нет источника для скачивания.");
      if (
        m.kind === "mlx" &&
        !(process.platform === "darwin" && process.arch === "arm64")
      )
        throw bad(
          "MLX требует Mac с Apple Silicon. На этой системе используй OpenAI.",
        );
      if (
        m.kind === "rvc" &&
        !(process.platform === "darwin" && process.arch === "arm64")
      )
        throw bad("Этот RVC-движок требует Mac с Apple Silicon.");
      spec = {
        ...m,
        path:
          m.kind === "mlx"
            ? path.join(this.models, m.id)
            : m.kind === "rvc"
              ? path.join(this.models, "voice", m.id, "model.npz")
              : null,
      };
    } else if (!["text", "voice", "rvc"].includes(kind))
      throw bad("Неизвестный установщик.");
    const requestFile = path.join(this.data, "install-request.json");
    await writeJSON(requestFile, {
      kind,
      model: spec,
      models: this.models,
      root: this.root,
      voice: this.config.voice,
      textPython: this.config.textPython,
    });
    const child = spawn(
      process.execPath,
      [
        path.join(this.root, "scripts/install-engine.mjs"),
        "request",
        requestFile,
      ],
      {
        cwd: this.root,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    this.installer = child;
    let tail = "";
    const line = (l) => {
      tail = (tail + "\n" + l).slice(-2500);
      onStage(l.length > 180 ? l.slice(0, 180) : l);
    };
    createInterface({ input: child.stdout }).on("line", line);
    createInterface({ input: child.stderr }).on("line", line);
    try {
      await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error("Установка не завершена. " + tail.slice(-500))),
        );
      });
      if (spec?.path) {
        this.get(id).path = spec.path;
      }
      if (spec && spec.kind !== "mlx")
        this.config.voice.assetsRoot = path.join(this.models, "voice");
      if (kind === "text")
        this.config.textPython = pythonIn(path.join(this.root, ".venv"));
      if (kind === "voice" || kind === "rvc") {
        this.config.voice = {
          python: pythonIn(path.join(this.root, ".venv-neural")),
          assetsRoot: path.join(this.models, "voice"),
          vendor: path.join(this.root, "vendor/rvc-mlx"),
        };
      }
      await this.save();
    } finally {
      if (this.installer === child) this.installer = null;
      await fs.rm(requestFile, { force: true });
    }
  }
}
