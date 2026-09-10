import test from "node:test";
import assert from "node:assert/strict";
import { world, example } from "../lib/seed.mjs";
import { ideaSettings, ideaMessages, parseIdea } from "../lib/ideas.mjs";
test("idea generation accepts a blank prompt and no cast while validating context", () => {
  const s = ideaSettings(
    { ...example.settings, prompt: "", heroes: [] },
    world,
  );
  assert.deepEqual(s.heroes, []);
  assert.equal(s.previousPrompt, "");
  assert.throws(() =>
    ideaSettings(
      { ...example.settings, prompt: "", heroes: ["unknown"] },
      world,
    ),
  );
  assert.throws(() =>
    ideaSettings({ ...example.settings, prompt: "x".repeat(2501) }, world),
  );
});
test("idea prompt uses saved lore, selected characters, mood and deduplication context", () => {
  const s = ideaSettings(
    {
      ...example.settings,
      prompt: "Предыдущая завязка",
      heroes: [world.characters[0].id],
      constraints: "Без новых чудес",
    },
    world,
  );
  const chat = ideaMessages(world, s, ["Недавняя идея"]);
  const context = JSON.parse(chat[0].content.split("ЛОР: ")[1]);
  assert.equal(context.laws, world.laws);
  assert.equal(context.characters.length, 1);
  assert.equal(context.characters[0].name, world.characters[0].name);
  const brief = JSON.parse(chat[1].content);
  assert.deepEqual(brief.avoid, ["Предыдущая завязка", "Недавняя идея"]);
  assert.equal(brief.constraints, "Без новых чудес");
  assert.equal(brief.mood.absurd, s.absurd);
});
test("malformed ideas fail visibly instead of falling back to a canned idea", () => {
  assert.equal(
    parseIdea('```json\n{"idea":" Новая ситуация. "}\n```'),
    "Новая ситуация.",
  );
  for (const raw of [
    "{}",
    '{"idea":""}',
    "broken",
    JSON.stringify({ idea: "x".repeat(801) }),
  ])
    assert.throws(() => parseIdea(raw));
});
