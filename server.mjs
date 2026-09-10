import {
  ideaSchema,
  ideaSettings,
  ideaMessages,
  parseIdea,
} from "./lib/ideas.mjs";
import {
  imageModels,
  imageDefaults,
  imageSettings,
  characterMessages,
  characterSchema,
  parseCharacter,
  characterDescription,
  scenePrompt,
  portraitPrompt,
} from "./lib/creative.mjs";
import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { world as seedWorld, example } from "./lib/seed.mjs";
import { makeEngines } from "./lib/engines.mjs";
import ffmpeg from "ffmpeg-static";
import { ModelManager } from "./lib/models.mjs";
import { OpenAIService } from "./lib/openai.mjs";
import { Worlds } from "./lib/worlds.mjs";
import {
  bad,
  validateWorld,
  validateSettings,
  messages,
  parseStory,
  record,
  markdown,
  splitSpeech,
} from "./lib/stories.mjs";
try {
  process.loadEnvFile(fileURLToPath(new URL(".env", import.meta.url)));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const root = path.dirname(fileURLToPath(import.meta.url)),
  port = Number(process.env.PORT || 4321);
const data = process.env.STUDIO_DATA_DIR
    ? path.resolve(process.env.STUDIO_DATA_DIR)
    : path.join(root, "data"),
  library = path.join(data, "stories"),
  audioRoot = path.join(data, "audio");
await Promise.all([
  fs.mkdir(library, { recursive: true }),
  fs.mkdir(audioRoot, { recursive: true }),
]);
const manager = new ModelManager(
  root,
  data,
  process.env.STUDIO_MODELS_DIR
    ? path.resolve(process.env.STUDIO_MODELS_DIR)
    : path.join(root, "models"),
);
await manager.load();
const openai = new OpenAIService(root, data);
await openai.load();
let imageConfig = imageSettings(
  await (
    await import("./lib/storage.mjs")
  ).readJSON(path.join(data, "image-settings.json"), imageDefaults),
);
let engines = makeEngines(root, { ...manager.config, data });
const exec = promisify(execFile);
const rebuildEngines = () => {
  engines.text.stop();
  engines.voice.stop();
  engines = makeEngines(root, { ...manager.config, data });
};
const voices = () =>
  manager.config.entries.filter((m) => m.kind !== "mlx" && m.enabled);
const atomic = async (file, value) => {
  const tmp = file + "." + randomUUID() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
};
const read = async (file, fallback) => {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
};
const worlds = new Worlds(data, seedWorld, () => voices().map((v) => v.id));
await worlds.load();
let world = worlds.current;
if (!(await read(path.join(data, "initialized.json"), null))) {
  await atomic(path.join(library, example.id + ".json"), {
    ...example,
    worldSnapshot: seedWorld,
  });
  await worlds.save(world);
  await atomic(path.join(data, "initialized.json"), {
    date: new Date().toISOString(),
  });
}
const allStories = async () => {
  const names = (await fs.readdir(library)).filter((n) => n.endsWith(".json"));
  return (
    await Promise.all(names.map((n) => read(path.join(library, n), null)))
  )
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};
const idPattern = /^(?:[a-f0-9-]{36}|example-kvasar)$/;
async function getStory(id) {
  if (!idPattern.test(id)) throw bad("История не найдена.", 404);
  const s = await read(path.join(library, id + ".json"), null);
  if (!s) throw bad("История не найдена.", 404);
  return s;
}
let mutation = Promise.resolve();
function locked(fn) {
  const p = mutation.then(fn, fn);
  mutation = p.catch(() => {});
  return p;
}
let jobs = await read(path.join(data, "jobs.json"), []),
  active = null;
for (const j of jobs)
  if (j.status === "running") {
    j.status = "error";
    j.error = "Студия была закрыта. Запусти задачу ещё раз.";
  }
const publicJob = (j) => {
  if (!j) return null;
  const { characterWorld, ...view } = j;
  const compactImage = ({ prompt, scene, settings, ...a }) => a;
  if (view.images) view.images = view.images.map(compactImage);
  if (view.portrait) view.portrait = compactImage(view.portrait);
  return view;
};
const saveJobs = () => atomic(path.join(data, "jobs.json"), jobs.slice(0, 40));
await saveJobs();
function newJob(type, settings) {
  if (active) throw bad("Дождись текущей задачи или останови её.", 409);
  const job = {
    id: randomUUID(),
    type,
    settings,
    status: "running",
    stage: "Готовим задачу…",
    createdAt: new Date().toISOString(),
    results: [],
  };
  active = job;
  jobs.unshift(job);
  return job;
}
async function runJob(job, fn) {
  try {
    await saveJobs();
    await fn();
    if (job.status === "running") job.status = "done";
  } catch (e) {
    if (job.status !== "cancelled") {
      job.status = "error";
      job.error = e.message;
      console.error("Job:", e.message);
    }
  } finally {
    job.finishedAt = new Date().toISOString();
    if (job.status === "done") {
      job.stage = "Готово";
      if (job.progress) job.progress.completed = job.progress.total;
    }
    if (active === job) active = null;
    await saveJobs();
  }
}
function stage(job, text) {
  if (job.status === "cancelled") throw bad("Задача остановлена.");
  job.stage = text;
}
function checkCancelled(job) {
  if (job.status === "cancelled") throw bad("Задача остановлена.");
}
async function generate(job, s, rewrite) {
  const w = structuredClone(rewrite?.worldSnapshot || world),
    recent = await allStories(),
    connection = structuredClone(manager.config.text);
  engines.voice.stop();
  units(job, 0, s.count, "вариантов");
  for (let i = 0; i < s.count; i++) {
    checkCancelled(job);
    const settings = { ...s, seed: (s.seed + i) % 2147483648 };
    const chat = messages(
      w,
      settings,
      [
        ...job.results
          .map((id) => recent.find((r) => r.id === id))
          .filter(Boolean),
        ...recent,
      ],
      rewrite,
    );
    let story;
    for (
      let attempt = 0;
      attempt < (connection.provider === "openai" ? 1 : 2);
      attempt++
    ) {
      const progress = (t) =>
        stage(job, `Вариант ${i + 1} из ${s.count} · ${t}`);
      let raw;
      if (connection.provider === "openai") {
        const response = await openai.generate(
          {
            messages: chat,
            speakers: [
              "Рассказчик",
              ...w.characters
                .filter((c) => s.heroes.includes(c.id))
                .map((c) => c.name),
            ],
            model: connection.modelId,
            reasoning: connection.reasoning,
            jobId: job.id,
          },
          progress,
        );
        raw = response.text;
      } else {
        const model = manager.get(connection.modelId);
        raw = await engines.text.call(
          {
            messages: chat,
            model_path: model.path,
            seed: settings.seed,
            temperature: attempt ? 0.45 : s.temperature,
            max_tokens: 3600,
          },
          progress,
        );
      }
      checkCancelled(job);
      try {
        story = parseStory(raw, w, s);
        break;
      } catch (e) {
        await fs.mkdir(path.join(data, "diagnostics"), { recursive: true });
        await fs.writeFile(
          path.join(
            data,
            "diagnostics",
            job.id + "-" + i + "-" + attempt + ".txt",
          ),
          raw,
          { mode: 0o600 },
        );
        if (attempt || connection.provider === "openai")
          throw new Error(
            e.message + " Попробуй ещё раз: исходные истории сохранены.",
          );
        chat.push(
          { role: "assistant", content: raw },
          {
            role: "user",
            content:
              "Исправь структуру JSON. " +
              e.message +
              " Верни полный завершённый JSON с короткими полями и 4–6 сценами.",
          },
        );
      }
    }
    const r = record(story, { ...settings, connection });
    r.engine =
      connection.provider === "openai"
        ? "OpenAI · " + connection.modelId
        : manager.get(connection.modelId).name + " · локально";
    r.worldSnapshot = w;
    r.worldId = w.id;
    r.parentId = rewrite?.parentId;
    await locked(() => atomic(path.join(library, r.id + ".json"), r));
    job.results.push(r.id);
    recent.unshift(r);
    units(job, i + 1, s.count, "вариантов");
    await saveJobs();
  }
}
const fmt = (t) => {
  const n = Math.max(0, Math.round(t * 1000));
  return `${String(Math.floor(n / 3600000)).padStart(2, "0")}:${String(Math.floor(n / 60000) % 60).padStart(2, "0")}:${String(Math.floor(n / 1000) % 60).padStart(2, "0")},${String(n % 1000).padStart(3, "0")}`;
};
function voiceSettings(input = {}) {
  const v = {
    voice: input.voice || "aidar",
    speed: Number(input.speed ?? 1),
    pitch: Number(input.pitch ?? 0),
    assignments: input.assignments || {},
  };
  if (
    typeof v.voice !== "string" ||
    !/^[a-z0-9-]{1,80}$/.test(v.voice) ||
    !Number.isFinite(v.speed) ||
    v.speed < 0.7 ||
    v.speed > 1.4 ||
    !Number.isFinite(v.pitch) ||
    v.pitch < -6 ||
    v.pitch > 6 ||
    typeof v.assignments !== "object" ||
    Object.values(v.assignments).some(
      (x) => typeof x !== "string" || !/^[a-z0-9-]{1,80}$/.test(x),
    )
  )
    throw bad("Проверь настройки голоса.");
  return v;
}
async function renderVoice(job, scenes, v, storyId, revision) {
  engines.text.stop();
  let offset = 0,
    cues = [],
    files = [],
    idx = 0;
  const dir = path.join(audioRoot, job.id);
  await fs.mkdir(dir, { recursive: true });
  units(
    job,
    0,
    scenes.reduce((n, s) => n + splitSpeech(s.text).length, 0),
    "фрагментов речи",
  );
  for (let i = 0; i < scenes.length; i++) {
    for (const text of splitSpeech(scenes[i].text)) {
      checkCancelled(job);
      const part = "part-" + String(idx++).padStart(3, "0"),
        out = path.join(dir, part);
      const voice = v.assignments[scenes[i].speaker] || v.voice;
      const profile = manager.get(voice);
      if (!profile.enabled || !(await manager.available(profile)))
        throw bad(
          "Голос " +
            profile.name +
            " отключён или не скачан. Открой управление моделями.",
        );
      const result = await engines.voice.call(
        {
          text,
          voice,
          profile,
          punch: false,
          directory: out,
          settings: { speed: v.speed, pitch: v.pitch, pause: 0, hold: 0.3 },
        },
        (t) => stage(job, `Сцена ${i + 1} из ${scenes.length} · ${t}`),
      );
      checkCancelled(job);
      files.push(part + "/voice.wav");
      for (let k = 0; k < result.words.length; k += 7) {
        const words = result.words.slice(k, k + 7);
        cues.push(
          `${cues.length + 1}\n${fmt(offset + words[0].start)} --> ${fmt(offset + words.at(-1).end)}\n${words.map((w) => w.word).join(" ")}\n`,
        );
      }
      offset += result.duration;
      job.progress.completed++;
    }
  }
  checkCancelled(job);
  stage(job, "Собираем общую дорожку и субтитры…");
  await fs.writeFile(
    path.join(dir, "concat.txt"),
    files.map((f) => `file '${f}'`).join("\n"),
  );
  await exec(
    process.env.FFMPEG_PATH || ffmpeg,
    [
      "-y",
      "-v",
      "error",
      "-f",
      "concat",
      "-safe",
      "1",
      "-i",
      path.join(dir, "concat.txt"),
      "-c:a",
      "pcm_s16le",
      path.join(dir, "narration.wav"),
    ],
    { timeout: 120000 },
  );
  checkCancelled(job);
  await fs.writeFile(path.join(dir, "subtitles.srt"), cues.join("\n"));
  const audio = {
    id: job.id,
    url: `/media/${job.id}/narration.wav`,
    subtitles: `/media/${job.id}/subtitles.srt`,
    duration: offset,
    settings: v,
  };
  job.audio = audio;
  if (storyId)
    await locked(async () => {
      const latest = await getStory(storyId);
      if (latest.revision === revision) {
        latest.audio = audio;
        await atomic(path.join(library, storyId + ".json"), latest);
        job.results = [storyId];
      } else
        job.notice = "Озвучена предыдущая версия. Текущие правки сохранены.";
    });
}
async function readyText() {
  if (manager.config.text.provider === "openai") await openai.key();
  else {
    const m = manager.get(manager.config.text.modelId);
    if (!m.enabled || !(await manager.available(m)))
      throw bad("Скачай или подключи текстовую модель в настройках.");
  }
}
function units(job, completed, total, label) {
  job.progress = { completed, total, label };
}
async function saveImage(job, request) {
  const result = await openai.image(
    { ...request, jobId: job.id, accountId: job.accountId },
    (t) => stage(job, t),
  );
  // A response can finish just as cancellation arrives: preserve the paid result.
  const id = randomUUID(),
    dir = path.join(data, "images", job.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, id + ".png"), result.bytes);
  const asset = {
    id,
    url: `/images/${job.id}/${id}.png`,
    model: result.model,
    usageId: result.usageId,
    cost: result.cost,
    createdAt: new Date().toISOString(),
    prompt: request.prompt,
    settings: request.settings,
  };
  (job.images ||= []).push(asset);
  await saveJobs();
  return asset;
}
async function generateIdea(job, w, s, connection) {
  engines.voice.stop();
  units(job, 0, 1, "идей");
  const recent = jobs
    .filter((j) => j.type === "idea" && j.worldId === w.id && j.idea)
    .slice(0, 8)
    .map((j) => j.idea);
  const stories = (await allStories())
    .filter((r) => r.worldId === w.id || r.worldSnapshot?.id === w.id)
    .slice(0, 5)
    .map((r) => r.logline);
  const chat = ideaMessages(w, s, [...recent, ...stories]);
  const progress = (t) =>
    stage(job, t.replace("Пишем историю", "Придумываем идею"));
  let raw;
  if (connection.provider === "openai")
    raw = (
      await openai.generate(
        {
          messages: chat,
          schema: ideaSchema,
          schemaName: "cosmos_idea",
          stageLabel: "OpenAI придумывает идею…",
          model: connection.modelId,
          reasoning: connection.reasoning,
          accountId: job.accountId,
          jobId: job.id,
        },
        progress,
      )
    ).text;
  else
    raw = await engines.text.call(
      {
        messages: chat,
        model_path: manager.get(connection.modelId).path,
        seed: Math.floor(Math.random() * 2147483647),
        temperature: s.temperature,
        max_tokens: 900,
      },
      progress,
    );
  checkCancelled(job);
  job.idea = parseIdea(raw);
  units(job, 1, 1, "идей");
}
async function generateFrames(job, r, indices, config) {
  const w = r.worldSnapshot || world;
  const cast = w.characters.filter((c) => r.settings.heroes.includes(c.id));
  units(job, 0, indices.length, "кадров");
  for (const [n, i] of indices.entries()) {
    checkCancelled(job);
    const scene = r.story.scenes[i];
    stage(job, `Кадр ${n + 1} из ${indices.length} · собираем лор и героев`);
    job.itemLabel = `Сцена ${i + 1} · ${n + 1} из ${indices.length}`;
    const asset = await saveImage(job, {
      prompt: scenePrompt(w, r, scene, config),
      settings: config,
      references: cast.filter((c) => c.portraitData).map((c) => c.portraitData),
    });
    Object.assign(asset, {
      sceneIndex: i,
      scene: structuredClone(scene),
      storyId: r.id,
    });
    await locked(async () => {
      const latest = await getStory(r.id);
      (latest.images ||= []).push(asset);
      await atomic(path.join(library, r.id + ".json"), latest);
    });
    job.results = [r.id];
    units(job, n + 1, indices.length, "кадров");
    await saveJobs();
  }
}
async function generateCharacter(
  job,
  w,
  brief,
  withPortrait,
  config,
  connection,
) {
  engines.voice.stop();
  const ids = voices().map((v) => v.id);
  if (!ids.length) ids.push("aidar");
  const chat = characterMessages(w, brief, ids);
  units(job, 0, withPortrait ? 2 : 1, "этапов");
  let raw;
  if (connection.provider === "openai")
    raw = (
      await openai.generate(
        {
          messages: chat,
          schema: characterSchema(ids),
          schemaName: "cosmos_character",
          model: connection.modelId,
          reasoning: connection.reasoning,
          jobId: job.id,
          accountId: job.accountId,
        },
        (t) => stage(job, t.replace("Пишем историю", "Придумываем персонажа")),
      )
    ).text;
  else
    raw = await engines.text.call(
      {
        messages: chat,
        model_path: manager.get(connection.modelId).path,
        seed: Math.floor(Math.random() * 2147483647),
        temperature: 0.8,
        max_tokens: 3400,
      },
      (t) => stage(job, t.replace("Пишем историю", "Придумываем персонажа")),
    );
  checkCancelled(job);
  job.character = parseCharacter(raw, ids);
  job.worldId = w.id;
  job.worldName = w.name;
  job.characterWorld = {
    ...w,
    characters: w.characters.map(({ portraitData, ...c }) => c),
  };
  units(job, 1, withPortrait ? 2 : 1, "этапов");
  await saveJobs();
  if (withPortrait) {
    stage(job, "Карточка готова · рисуем портрет");
    job.itemLabel = "Портрет персонажа";
    job.portrait = await saveImage(job, {
      prompt: portraitPrompt(w, job.character, config),
      settings: { ...config, size: "1024x1024" },
    });
    units(job, 2, 2, "этапов");
  }
}

async function body(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw bad("Нужен JSON.", 415);
  let raw = "";
  for await (const b of req) {
    raw += b;
    if (Buffer.byteLength(raw) > 8000000)
      throw bad("Слишком большой запрос.", 413);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw bad("Некорректный JSON.");
  }
}
function json(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
async function runtime() {
  const models = await manager.view(),
    account = await openai.view();
  const selected = models.entries.find((m) => m.id === models.text.modelId);
  return {
    model:
      models.text.provider === "openai"
        ? !!account.active
        : !!selected?.installed && models.textRuntime,
    voice:
      models.entries.some(
        (m) => m.kind !== "mlx" && m.enabled && m.installed,
      ) && models.voiceRuntime,
    modelName:
      models.text.provider === "openai"
        ? "gpt-5.6-luna"
        : selected?.name || "Модель не выбрана",
    local: models.text.provider === "mlx",
  };
}
async function file(req, res, filename) {
  const stat = await fs.stat(filename);
  let start = 0,
    end = stat.size - 1,
    status = 200;
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".wav": "audio/wav",
    ".srt": "text/plain; charset=utf-8",
  };
  const headers = {
    "Content-Type": mime[path.extname(filename)] || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };
  if (req.headers.range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!m || (!m[1] && !m[2])) {
      res.writeHead(416);
      return res.end();
    }
    if (!m[1]) start = Math.max(0, stat.size - Number(m[2]));
    else {
      start = Number(m[1]);
      if (m[2]) end = Math.min(end, Number(m[2]));
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      return res.end();
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers["Content-Length"] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === "HEAD") return res.end();
  const stream = createReadStream(filename, { start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || "";
    if (
      !["127.0.0.1:" + port, "localhost:" + port].includes(host) ||
      (req.headers.origin && req.headers.origin !== `http://${host}`) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return json(res, 403, { error: "Доступ только из локальной студии." });
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; frame-ancestors 'none'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const url = new URL(req.url, "http://" + host),
      p = url.pathname;
    if (req.method === "GET" && p === "/api/bootstrap")
      return json(res, 200, {
        world,
        worlds: await worlds.list(),
        voices: await manager.voices(),
        models: await manager.view(),
        account: await openai.view(),
        imageSettings: { settings: imageConfig, models: imageModels },
        stories: await allStories(),
        status: await runtime(),
        active: publicJob(active),
        jobs: jobs.slice(0, 10).map(publicJob),
      });
    if (req.method === "GET" && p === "/api/stories")
      return json(res, 200, await allStories());
    if (req.method === "PUT" && p === "/api/world") {
      world = await worlds.save(await body(req));
      return json(res, 200, world);
    }
    if (req.method === "POST" && p === "/api/ideas/generate") {
      const b = await body(req);
      if (b.worldId !== world.id)
        throw bad("Мир изменился в другой вкладке. Открой его заново.", 409);
      const w = structuredClone(world),
        s = ideaSettings(b.settings, w),
        connection = structuredClone(manager.config.text);
      await readyText();
      const accountId = (await openai.view()).active;
      const job = newJob("idea", s);
      Object.assign(job, {
        worldId: w.id,
        worldName: w.name,
        connection,
        accountId,
      });
      json(res, 202, publicJob(job));
      void runJob(job, () => generateIdea(job, w, s, connection));
      return;
    }
    if (req.method === "POST" && p === "/api/generate") {
      const b = await body(req);
      let rewrite = null;
      if (b.rewrite) {
        if (
          typeof b.rewrite.instruction !== "string" ||
          !b.rewrite.instruction.trim() ||
          b.rewrite.instruction.length > 2000
        )
          throw bad("Напиши, что изменить.");
        const r = await getStory(b.rewrite.id);
        rewrite = {
          instruction: b.rewrite.instruction,
          story: r.story,
          parentId: r.id,
          worldSnapshot: r.worldSnapshot || world,
        };
      }
      const s = validateSettings(b.settings, rewrite?.worldSnapshot || world);
      if (rewrite) s.count = 1;
      if (manager.config.text.provider === "mlx") {
        const m = manager.get(manager.config.text.modelId);
        if (!m.enabled || !(await manager.available(m)))
          throw bad("Скачай или подключи текстовую модель в настройках.");
      } else await openai.key();
      const job = newJob("story", s);
      json(res, 202, publicJob(job));
      void runJob(job, () => generate(job, s, rewrite));
      return;
    }
    if (req.method === "GET" && p === "/api/image-settings")
      return json(res, 200, { settings: imageConfig, models: imageModels });
    if (req.method === "PUT" && p === "/api/image-settings") {
      imageConfig = imageSettings(await body(req));
      await atomic(path.join(data, "image-settings.json"), imageConfig);
      return json(res, 200, { settings: imageConfig, models: imageModels });
    }
    if (req.method === "GET" && p === "/api/jobs")
      return json(res, 200, {
        active: publicJob(active),
        jobs: jobs.slice(0, 40).map(publicJob),
      });
    if (req.method === "POST" && p === "/api/characters/generate") {
      const b = await body(req);
      if (
        typeof b.brief !== "string" ||
        !b.brief.trim() ||
        b.brief.length > 2500 ||
        typeof b.portrait !== "boolean"
      )
        throw bad("Опиши героя: до 2500 символов.");
      await readyText();
      if (b.portrait) await openai.key();
      const w = structuredClone(world),
        connection = structuredClone(manager.config.text),
        config = structuredClone(imageConfig);
      const job = newJob("character", {
        brief: b.brief,
        portrait: b.portrait,
        connection,
      });
      job.worldId = w.id;
      job.worldName = w.name;
      job.characterWorld = {
        ...w,
        characters: w.characters.map(({ portraitData, ...c }) => c),
      };
      job.accountId = (await openai.view()).active;
      json(res, 202, publicJob(job));
      void runJob(job, () =>
        generateCharacter(job, w, b.brief, b.portrait, config, connection),
      );
      return;
    }
    const portraitMatch = /^\/api\/characters\/([a-f0-9-]{36})\/portrait$/.exec(
      p,
    );
    if (req.method === "POST" && portraitMatch) {
      const source = jobs.find((j) => j.id === portraitMatch[1]);
      if (!source?.characterWorld || !source.character)
        throw bad("Карточка не найдена.", 404);
      const b = await body(req),
        c = parseCharacter(b.character, [
          ...new Set([...voices().map((v) => v.id), source.character.voice]),
        ]);
      await openai.key();
      const config = structuredClone(imageConfig);
      const job = newJob("character", { portrait: true });
      Object.assign(job, {
        character: c,
        characterWorld: source.characterWorld,
        worldId: source.worldId,
        worldName: source.worldName,
        accountId: (await openai.view()).active,
      });
      json(res, 202, publicJob(job));
      void runJob(job, async () => {
        units(job, 0, 1, "портретов");
        job.portrait = await saveImage(job, {
          prompt: portraitPrompt(job.characterWorld, c, config),
          settings: { ...config, size: "1024x1024" },
        });
        units(job, 1, 1, "портретов");
      });
      return;
    }
    const acceptMatch = /^\/api\/characters\/([a-f0-9-]{36})\/accept$/.exec(p);
    if (req.method === "POST" && acceptMatch) {
      const job = jobs.find((j) => j.id === acceptMatch[1]);
      if (!job?.character) throw bad("Карточка не найдена.", 404);
      if (job.status === "running")
        throw bad("Дождись портрета или останови задачу.", 409);
      const b = await body(req),
        c = parseCharacter(b.character, [
          ...new Set([...voices().map((v) => v.id), job.character.voice]),
        ]);
      const character = {
        id: "hero-" + job.id.slice(0, 8),
        name: c.name,
        role: c.role,
        description: characterDescription(c),
        voice: c.voice,
        portrait: null,
        ...(b.portraitData ? { portraitData: b.portraitData } : {}),
      };
      const updated = await worlds.addCharacter(job.worldId, character);
      world = worlds.current;
      job.accepted = true;
      await saveJobs();
      return json(res, 200, { world: updated, character });
    }

    if (req.method === "GET" && p === "/api/models")
      return json(res, 200, await manager.view());
    if (req.method === "PUT" && p === "/api/models/settings") {
      if (active) throw bad("Сначала дождись задачи или останови её.", 409);
      const result = await manager.update(await body(req));
      rebuildEngines();
      return json(res, 200, result);
    }
    if (req.method === "POST" && p === "/api/models") {
      if (active) throw bad("Дождись текущей задачи.", 409);
      return json(res, 201, await manager.add(await body(req)));
    }
    const modelMatch =
      /^\/api\/models\/([a-z0-9-]+)(?:\/(install|files))?$/.exec(p);
    if (modelMatch) {
      const [, id, action] = modelMatch;
      if (active) throw bad("Сначала дождись задачи или останови её.", 409);
      if (req.method === "PUT" && !action) {
        const b = await body(req);
        const result = await manager.toggle(id, b.enabled);
        rebuildEngines();
        return json(res, 200, result);
      }
      if (req.method === "DELETE" && action === "files") {
        engines.text.stop();
        engines.voice.stop();
        return json(res, 200, await manager.removeFiles(id));
      }
      if (req.method === "POST" && action === "install") {
        const job = newJob("install", { model: id });
        json(res, 202, publicJob(job));
        void runJob(job, async () => {
          engines.text.stop();
          engines.voice.stop();
          await manager.install("model", id, (t) => {
            if (job.status === "running") stage(job, t);
          });
          rebuildEngines();
        });
        return;
      }
    }
    if (req.method === "POST" && p === "/api/engines/install") {
      const b = await body(req);
      if (!["text", "voice", "rvc"].includes(b.kind))
        throw bad("Выбери движок.");
      const job = newJob("install", { engine: b.kind });
      json(res, 202, publicJob(job));
      void runJob(job, async () => {
        engines.text.stop();
        engines.voice.stop();
        await manager.install(b.kind, null, (t) => {
          if (job.status === "running") stage(job, t);
        });
        rebuildEngines();
      });
      return;
    }
    if (req.method === "GET" && p === "/api/account")
      return json(res, 200, await openai.view());
    if (req.method === "POST" && p === "/api/account/keys")
      return json(res, 201, await openai.add(await body(req)));
    const keyMatch =
      /^\/api\/account\/keys\/([a-f0-9]{16}|env-[a-f0-9]{16})(?:\/(check|activate))?$/.exec(
        p,
      );
    if (keyMatch) {
      const [, id, action] = keyMatch;
      if (req.method === "POST" && action === "check")
        return json(res, 200, await openai.check(id));
      if (req.method === "POST" && action === "activate")
        return json(res, 200, await openai.select(id));
      if (req.method === "DELETE" && !action)
        return json(res, 200, await openai.remove(id));
    }
    if (req.method === "GET" && p === "/api/worlds")
      return json(res, 200, await worlds.list());
    if (req.method === "GET" && p === "/api/world/export") {
      res.setHeader("Content-Disposition", 'attachment; filename="world.json"');
      return json(res, 200, world);
    }
    if (req.method === "POST" && p === "/api/worlds") {
      const b = await body(req);
      world = await worlds.create(b.world);
      return json(res, 201, world);
    }
    const worldMatch =
      /^\/api\/worlds\/(maly-kosmos|[a-f0-9-]{36})\/activate$/.exec(p);
    if (req.method === "POST" && worldMatch) {
      world = await worlds.activate(worldMatch[1]);
      return json(res, 200, world);
    }
    const jobMatch = /^\/api\/jobs\/([a-f0-9-]{36})$/.exec(p);
    if (jobMatch) {
      const job = jobs.find((j) => j.id === jobMatch[1]);
      if (!job) throw bad("Задача не найдена.", 404);
      if (req.method === "GET") return json(res, 200, publicJob(job));
      if (req.method === "DELETE") {
        if (job.status === "running") {
          job.status = "cancelled";
          engines.text.stop();
          engines.voice.stop();
          openai.stop();
          manager.cancelInstall();
          await saveJobs();
        }
        return json(res, 200, publicJob(job));
      }
    }
    const storyMatch =
      /^\/api\/stories\/([^/]+)(?:\/(export|audio|images))?$/.exec(p);
    if (storyMatch) {
      const [, id, action] = storyMatch;
      const r = await getStory(id);
      if (req.method === "GET" && action === "export") {
        const format = url.searchParams.get("format");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="story-${id.slice(0, 8)}.${format === "json" ? "json" : format === "txt" ? "txt" : "md"}"`,
        );
        res.setHeader(
          "Content-Type",
          format === "json"
            ? "application/json; charset=utf-8"
            : "text/plain; charset=utf-8",
        );
        return res.end(
          format === "json"
            ? JSON.stringify(r, null, 2)
            : format === "txt"
              ? r.story.scenes.map((s) => s.text).join("\n\n")
              : markdown(r),
        );
      }
      if (req.method === "PUT" && !action) {
        const b = await body(req);
        const s = parseStory(
          JSON.stringify(b.story),
          r.worldSnapshot || world,
          r.settings,
        );
        const v = b.voiceSettings
          ? voiceSettings(b.voiceSettings)
          : r.voiceSettings;
        const result = await locked(async () => {
          const current = await getStory(id);
          if (b.revision !== current.revision)
            throw bad(
              "История изменилась в другой вкладке. Открой её заново из библиотеки.",
              409,
            );
          const changed =
            JSON.stringify(
              current.story.scenes.map((s) => [s.speaker, s.text]),
            ) !== JSON.stringify(s.scenes.map((s) => [s.speaker, s.text])) ||
            JSON.stringify(current.voiceSettings) !== JSON.stringify(v);
          const next = {
            ...current,
            story: s,
            title: s.title,
            logline: s.logline,
            voiceSettings: v,
            revision: current.revision + 1,
            updatedAt: new Date().toISOString(),
          };
          if (changed) delete next.audio;
          await atomic(path.join(library, id + ".json"), next);
          return next;
        });
        return json(res, 200, result);
      }
      if (req.method === "DELETE" && !action) {
        if (active?.storyId === id)
          throw bad("Сначала останови генерацию для этой истории.", 409);
        await locked(() => fs.rm(path.join(library, id + ".json")));
        if (r.audio)
          await fs.rm(path.join(audioRoot, r.audio.id), {
            recursive: true,
            force: true,
          });
        return json(res, 200, { deleted: id });
      }
      if (req.method === "POST" && action === "audio") {
        const b = await body(req),
          v = voiceSettings(b);
        const job = newJob("audio", v);
        job.storyId = id;
        json(res, 202, publicJob(job));
        void runJob(job, () =>
          renderVoice(job, r.story.scenes, v, id, r.revision),
        );
        return;
      }
      if (req.method === "POST" && action === "images") {
        const b = await body(req);
        await openai.key();
        const indices =
          b.scenes === "all" ? r.story.scenes.map((_, i) => i) : b.scenes;
        if (
          !Array.isArray(indices) ||
          !indices.length ||
          indices.length > 15 ||
          indices.some(
            (i) => !Number.isInteger(i) || i < 0 || i >= r.story.scenes.length,
          ) ||
          new Set(indices).size !== indices.length
        )
          throw bad("Выбери сцены для изображений.");
        const config = imageSettings({ ...imageConfig, ...b.settings });
        const job = newJob("images", { scenes: indices, image: config });
        job.storyId = id;
        job.accountId = (await openai.view()).active;
        json(res, 202, publicJob(job));
        void runJob(job, () => generateFrames(job, r, indices, config));
        return;
      }
      if (req.method === "GET" && !action) return json(res, 200, r);
    }
    if (req.method === "POST" && p === "/api/voice-preview") {
      const b = await body(req),
        v = voiceSettings(b);
      if (typeof b.text !== "string" || !b.text.trim() || b.text.length > 300)
        throw bad("Для пробы нужно от 1 до 300 символов.");
      const job = newJob("preview", v);
      json(res, 202, publicJob(job));
      void runJob(job, () =>
        renderVoice(job, [{ speaker: "Рассказчик", text: b.text }], v),
      );
      return;
    }
    const media =
      /^\/media\/([a-f0-9-]{36})\/(narration\.wav|subtitles\.srt)$/.exec(p);
    if (["GET", "HEAD"].includes(req.method) && media)
      return await file(req, res, path.join(audioRoot, media[1], media[2]));
    const imageMedia = /^\/images\/([a-f0-9-]{36})\/([a-f0-9-]{36})\.png$/.exec(
      p,
    );
    if (["GET", "HEAD"].includes(req.method) && imageMedia)
      return await file(
        req,
        res,
        path.join(data, "images", imageMedia[1], imageMedia[2] + ".png"),
      );
    const files = {
      "/": "index.html",
      "/app.js": "app.js",
      "/settings.js": "settings.js",
      "/account.js": "account.js",
      "/creative.js": "creative.js",
      "/style.css": "style.css",
      "/village.png": "village.png",
      "/characters.png": "characters.png",
    };
    if (["GET", "HEAD"].includes(req.method) && files[p])
      return await file(req, res, path.join(root, "public", files[p]));
    json(res, 404, { error: "Не найдено." });
  } catch (e) {
    if (!res.headersSent)
      json(res, e.status || (e.code === "ENOENT" ? 404 : 500), {
        error: e.status
          ? e.message
          : "Не удалось выполнить действие. " + e.message,
      });
    else res.destroy();
  }
});
server.requestTimeout = 30000;
server.listen(port, "127.0.0.1", () =>
  console.log(`Малый космос → http://127.0.0.1:${port}`),
);
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    engines.text.stop();
    engines.voice.stop();
    openai.stop();
    manager.cancelInstall();
    server.close();
    process.exit(0);
  });
