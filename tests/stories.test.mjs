import test from "node:test";
import assert from "node:assert/strict";
import { world, example } from "../lib/seed.mjs";
import {
  validateSettings,
  validateWorld,
  parseStory,
  splitSpeech,
  messages,
} from "../lib/stories.mjs";
test("invalid generation settings are rejected before inference", () => {
  for (const s of [
    { ...example.settings, heroes: [] },
    { ...example.settings, heroes: ["intruder"] },
    { ...example.settings, seed: -1 },
    { ...example.settings, count: 99 },
    { ...example.settings, temperature: "oops" },
  ])
    assert.throws(() => validateSettings(s, world));
});
test("prompt is limited to selected heroes and includes continuity and revision instruction", () => {
  const s = { ...example.settings, heroes: ["venya"] };
  const p = JSON.stringify(
    messages(world, s, [], {
      instruction: "Укороти финал",
      story: { title: "Исходник" },
    }),
  );
  assert.match(p, /Ключ на антенне/);
  assert.doesNotMatch(p, /каменной головой/);
  assert.match(p, /Укороти финал/);
});
test("generated JSON accepts fenced response but rejects invented speaker and truncation", () => {
  assert.equal(
    parseStory(
      "```json\n" + JSON.stringify(example.story) + "\n```",
      world,
      example.settings,
    ).scenes.length,
    5,
  );
  assert.throws(() => parseStory('{"title":', world, example.settings));
  const s = structuredClone(example.story);
  s.scenes[0].speaker = "Чужой";
  assert.throws(() => parseStory(JSON.stringify(s), world, example.settings));
});
test("chunking preserves every word within voice model limits", () => {
  const text = "Не закрывай калитку, там ещё сосед. ".repeat(60).trim();
  const parts = splitSpeech(text);
  assert(parts.length > 1);
  assert(parts.every((p) => p.length <= 280));
  assert.equal(parts.join(" "), text.replace(/\s+/g, " "));
  assert.throws(() => splitSpeech("я".repeat(301)));
});
test("world rejects duplicate hero IDs and supports a custom character", () => {
  const w = structuredClone(world);
  w.characters.push({ ...w.characters[0] });
  assert.throws(() => validateWorld(w));
  w.characters.at(-1).id = "new-neighbor";
  w.characters.at(-1).name = "Другой сосед";
  w.characters.at(-1).portrait = null;
  assert.equal(validateWorld(w).characters.length, 7);
});
