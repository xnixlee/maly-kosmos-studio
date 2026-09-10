// Full HTTP workflow with a process-local OpenAI stub. No external calls or real keys.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, ".."),
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "cosmos-creative-api-"));
const base = "http://127.0.0.1:4324";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=";
const fixture = path.join(dir, "mock-openai.mjs");
await fs.writeFile(
  fixture,
  `
import {characterFields} from ${JSON.stringify(pathToFileURL(path.join(root, "lib/creative.mjs")).href)};
globalThis.fetch=async(url,opts)=>{
 if(!url.startsWith('https://api.openai.com/v1/'))throw new Error('Unexpected external request');
 await new Promise((resolve,reject)=>{const t=setTimeout(resolve,180);opts.signal?.addEventListener('abort',()=>{clearTimeout(t);reject(new Error('aborted'));},{once:true});});
 if(url.endsWith('/responses')) {
  const c=Object.fromEntries(Object.keys(characterFields).map(k=>[k,k==='voice'?'aidar':k==='name'?'Мастер орбит':'Конкретная деталь.']));
  return Response.json({status:'completed',id:'mock-response',usage:{input_tokens:100,output_tokens:300},output:[{content:[{type:'output_text',text:JSON.stringify(c)}]}]});
 }
 return Response.json({data:[{b64_json:${JSON.stringify(png)}}],usage:{input_tokens:100,output_tokens:1000,input_tokens_details:{text_tokens:100,image_tokens:0}}});
};
`,
);
const child = spawn(process.execPath, ["--import", fixture, "server.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: "4324",
    STUDIO_DATA_DIR: path.join(dir, "data"),
    STUDIO_MODELS_DIR: path.join(dir, "models"),
    OPENAI_API_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (output += b));
const pause = () => new Promise((r) => setTimeout(r, 40));
async function api(route, method = "GET", body) {
  const r = await fetch(base + route, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await r.json();
  assert(r.ok, `${route}: ${JSON.stringify(value)}`);
  return value;
}
async function ended(j) {
  for (let n = 0; n < 150; n++) {
    const x = await api("/api/jobs/" + j.id);
    if (x.status !== "running") return x;
    await pause();
  }
  throw new Error("Job timed out");
}
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/api/bootstrap")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await pause();
  }
  assert(ready, output);
  const initial = await api("/api/bootstrap"),
    original = initial.world.id;
  const noKey = await fetch(base + "/api/stories/example-kvasar/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenes: [0] }),
  });
  assert.equal(noKey.status, 400);
  await api("/api/account/keys", "POST", {
    name: "Fake key",
    key: "test-only-never-sent-1234567890",
  });
  await api("/api/models/settings", "PUT", {
    text: { provider: "openai", modelId: "gpt-5.6-luna", reasoning: "low" },
  });
  const character = await api("/api/characters/generate", "POST", {
    brief: "Придумай мастера орбит",
    portrait: true,
  });
  const other = await api("/api/worlds", "POST", {});
  const c = await ended(character);
  assert.equal(c.status, "done", c.error);
  assert.equal(c.progress.completed, 2);
  assert(c.portrait.url);
  const accepted = await api("/api/characters/" + c.id + "/accept", "POST", {
    character: c.character,
    portraitData: "data:image/png;base64," + png,
  });
  assert.equal(accepted.world.id, original);
  assert.equal((await api("/api/bootstrap")).world.id, other.id);
  await api("/api/characters/" + c.id + "/accept", "POST", {
    character: c.character,
  });
  const w = await api("/api/worlds/" + original + "/activate", "POST", {});
  assert.equal(
    w.characters.filter((x) => x.id === accepted.character.id).length,
    1,
  );
  const redraw = await ended(
    await api("/api/characters/" + c.id + "/portrait", "POST", {
      character: { ...c.character, appearance: "Иной силуэт" },
    }),
  );
  assert.equal(redraw.status, "done", redraw.error);
  assert(redraw.portrait.url);
  const story = await api("/api/stories/example-kvasar");
  const frames = await api("/api/stories/" + story.id + "/images", "POST", {
    scenes: [0, 1],
  });
  const originalLine = story.story.scenes[0].text;
  story.story.scenes[0].text = "Новая реплика во время рисования.";
  await api("/api/stories/" + story.id, "PUT", {
    story: story.story,
    revision: story.revision,
  });
  const f = await ended(frames);
  assert.equal(f.status, "done", f.error);
  assert.equal(f.images.length, 2);
  assert.equal(f.progress.completed, 2);
  const saved = await api("/api/stories/" + story.id);
  assert.equal(saved.story.scenes[0].text, "Новая реплика во время рисования.");
  assert.equal(saved.images[0].scene.text, originalLine);
  const image = await fetch(base + saved.images[0].url);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(
    (await image.arrayBuffer()).byteLength,
    Buffer.from(png, "base64").length,
  );
  const cancel = await api("/api/stories/" + story.id + "/images", "POST", {
    scenes: "all",
  });
  for (let i = 0; i < 100; i++) {
    const j = await api("/api/jobs/" + cancel.id);
    if (j.progress?.completed === 1) break;
    await pause();
  }
  await api("/api/jobs/" + cancel.id, "DELETE");
  const stopped = await ended(cancel);
  assert.equal(stopped.status, "cancelled");
  assert(stopped.images.length >= 1);
  assert(stopped.images.length < story.story.scenes.length);
  // Let the aborted provider request settle before reading its persisted ledger.
  await new Promise((r) => setTimeout(r, 100));
  const history = await api("/api/jobs");
  assert(history.jobs.some((j) => j.id === cancel.id));
  const account = await api("/api/account");
  assert(account.usage.usd > 0);
  assert(account.recent.some((r) => r.kind === "image"));
  assert(account.recent.some((r) => r.status === "unknown"));
  assert(!JSON.stringify(account).includes("test-only-never-sent"));
  console.log(
    "PASS: character + portrait, portrait retry, world switching, idempotent accept, scene edits during batch, PNG delivery, partial cancellation, task history and per-key image billing (mock API, no charges)",
  );
} finally {
  child.kill();
  await new Promise((r) => child.once("exit", r));
  await fs.rm(dir, { recursive: true, force: true });
}
