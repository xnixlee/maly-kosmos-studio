import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  imageSettings,
  calculateImageCost,
  characterFields,
  characterSchema,
  parseCharacter,
  characterDescription,
  characterMessages,
  scenePrompt,
} from "../lib/creative.mjs";
import { OpenAIService } from "../lib/openai.mjs";
import { Worlds } from "../lib/worlds.mjs";
import { world, example } from "../lib/seed.mjs";
const root = path.resolve(import.meta.dirname, "..");
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=";
const rates = {
  textInput: 5,
  cachedTextInput: 1.25,
  imageInput: 8,
  cachedImageInput: 2,
  imageOutput: 30,
};
const usage = {
  input_tokens: 150,
  output_tokens: 1000,
  input_tokens_details: { text_tokens: 100, image_tokens: 50 },
};
const character = Object.fromEntries(
  Object.keys(characterFields).map((k) => [
    k,
    k === "voice"
      ? "aidar"
      : k === "name"
        ? "Новый сосед"
        : "Конкретная деталь.",
  ]),
);
async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cosmos-creative-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test("image accounting separates text and image inputs; ambiguous usage stays unknown", () => {
  assert.equal(calculateImageCost(usage, rates).usd, 0.0309);
  assert.equal(
    calculateImageCost(
      {
        ...usage,
        input_tokens_details: {
          ...usage.input_tokens_details,
          cached_tokens: 20,
        },
      },
      rates,
    ),
    null,
  );
  const cached = {
    ...usage,
    input_tokens_details: {
      ...usage.input_tokens_details,
      cached_tokens: 30,
      cached_tokens_details: { text_tokens: 20, image_tokens: 10 },
    },
  };
  assert.equal(calculateImageCost(cached, rates).usd, 0.030765);
  assert.equal(calculateImageCost({ ...usage, input_tokens: 2 }, rates), null);
  assert.equal(calculateImageCost(null, rates), null);
  assert.equal(
    calculateImageCost({ ...usage, output_tokens: -1 }, rates),
    null,
  );
});
test("image configuration is bounded and character prompt includes lore but no portrait bytes", () => {
  assert.throws(() => imageSettings({ provider: "arbitrary-server" }));
  assert.throws(() => imageSettings({ size: "99999x99999" }));
  assert.equal(imageSettings().quality, "low");
  const w = structuredClone(world);
  w.characters[0].portraitData = "private-image-bytes";
  const prompt = characterMessages(w, "Новый сосед", ["aidar"]);
  assert.equal(JSON.parse(prompt[0].content.split("ЛОР: ")[1]).laws, w.laws);
  assert(!JSON.stringify(prompt).includes("private-image-bytes"));
  const scene = scenePrompt(
    w,
    example,
    example.story.scenes[0],
    imageSettings(),
  );
  assert(scene.includes(example.story.scenes[0].visual));
  assert.deepEqual(characterSchema(["aidar"]).properties.voice.enum, ["aidar"]);
  assert.equal(
    parseCharacter(JSON.stringify(character), ["aidar"]).name,
    "Новый сосед",
  );
  assert(characterDescription(character).includes("Слабость:"));
  assert.throws(() =>
    parseCharacter({ ...character, voice: "invented" }, ["aidar"]),
  );
  assert.throws(() =>
    parseCharacter({ ...character, appearance: "x".repeat(501) }, ["aidar"]),
  );
});
test("accepting a generated resident targets its original world and is idempotent", async (t) => {
  const dir = await temp(t),
    w = new Worlds(dir, world, () => ["aidar"]);
  await w.load();
  const original = w.current.id;
  const other = await w.create();
  const c = {
    id: "hero-test",
    name: "Новый",
    role: "Сосед",
    description: "Желание",
    voice: "aidar",
    portrait: null,
  };
  const result = await w.addCharacter(original, c);
  assert(result.characters.some((x) => x.id === c.id));
  assert.equal(w.current.id, other.id);
  assert(!w.current.characters.some((x) => x.id === c.id));
  await w.addCharacter(original, c);
  const again = await w.activate(original);
  assert.equal(again.characters.filter((x) => x.id === c.id).length, 1);
  await assert.rejects(w.addCharacter("../world", c));
});
test("image requests use selected model and multipart references, persist billing and hide secrets", async (t) => {
  const dir = await temp(t);
  let request;
  const svc = new OpenAIService(
    root,
    dir,
    async (url, opts) => {
      request = { url, opts };
      return new Response(JSON.stringify({ data: [{ b64_json: png }], usage }));
    },
    {},
  );
  await svc.load();
  await svc.add({ name: "Mock", key: "test-only-image-key-1234567890" });
  const result = await svc.image({
    prompt: "A character",
    settings: imageSettings(),
    jobId: "test",
  });
  assert.equal(request.url, "https://api.openai.com/v1/images/generations");
  assert.equal(JSON.parse(request.opts.body).n, 1);
  assert.equal(result.cost.usd, 0.0309);
  assert.equal(result.bytes[0], 137);
  await svc.image({
    prompt: "Frame with character",
    settings: imageSettings(),
    references: ["data:image/png;base64," + png],
  });
  assert.equal(request.url, "https://api.openai.com/v1/images/edits");
  assert(request.opts.body instanceof FormData);
  assert.equal(request.opts.body.getAll("image[]").length, 1);
  assert.equal(request.opts.headers["Content-Type"], undefined);
  const view = await svc.view();
  assert.equal(view.usage.usd, 0.0618);
  assert(!JSON.stringify(view).includes("test-only-image-key"));
  const second = new OpenAIService(root, dir, fetch, {});
  await second.load();
  assert.equal((await second.view()).usage.usd, 0.0618);
});
test("image errors never cause a paid retry; invalid output is still billed; abort is unknown", async (t) => {
  const dir = await temp(t);
  let calls = 0;
  const svc = new OpenAIService(
    root,
    dir,
    async () => {
      calls++;
      return new Response("{}", { status: 429 });
    },
    {},
  );
  await svc.load();
  await svc.add({ name: "Mock", key: "test-only-image-key-1234567890" });
  await assert.rejects(svc.image({ prompt: "Frame" }));
  assert.equal(calls, 1);
  assert.equal((await svc.view()).recent[0].status, "failed");
  svc.fetcher = async () => new Response(JSON.stringify({ data: [], usage }));
  await assert.rejects(svc.image({ prompt: "Frame" }));
  assert.equal((await svc.view()).usage.usd, 0.0309);
  svc.fetcher = async (url, { signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
      setImmediate(() => svc.stop());
    });
  await assert.rejects(svc.image({ prompt: "Frame" }));
  assert.equal((await svc.view()).recent[0].status, "unknown");
});
