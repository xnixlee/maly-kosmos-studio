import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModelManager } from "../lib/models.mjs";
import { Worlds } from "../lib/worlds.mjs";
import { world } from "../lib/seed.mjs";
const root = path.resolve(import.meta.dirname, "..");
async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cosmos-models-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test("clean installation starts with missing optional models; external files cannot be deleted", async (t) => {
  const dir = await temp(t),
    mgr = new ModelManager(root, dir, path.join(dir, "models"));
  await mgr.load();
  assert(
    !(await mgr.view()).entries.find((x) => x.id === "qwen3-4b").installed,
  );
  const ext = path.join(dir, "external");
  await fs.mkdir(ext);
  await fs.writeFile(path.join(ext, "model.safetensors"), "test");
  await mgr.add({ name: "External model", kind: "mlx", path: ext });
  const m = mgr.config.entries.at(-1);
  await assert.rejects(mgr.removeFiles(m.id));
  await fs.access(path.join(ext, "model.safetensors"));
  await mgr.toggle(m.id, false);
  assert.equal(mgr.get(m.id).enabled, false);
});
test("download entries require safe repo and a pinned commit", async (t) => {
  const dir = await temp(t),
    mgr = new ModelManager(root, dir, path.join(dir, "models"));
  await mgr.load();
  await assert.rejects(
    mgr.add({
      name: "test",
      kind: "mlx",
      repo: "../../secret",
      revision: "a".repeat(40),
    }),
  );
  await assert.rejects(
    mgr.add({
      name: "test",
      kind: "mlx",
      repo: "author/model",
      revision: "main",
    }),
  );
  await mgr.add({
    name: "test",
    kind: "mlx",
    repo: "author/model",
    revision: "a".repeat(40),
  });
  assert.equal(mgr.config.entries.at(-1).revision, "a".repeat(40));
});
test("independent worlds import/export and switching preserve each lore", async (t) => {
  const dir = await temp(t),
    worlds = new Worlds(dir, world, () => ["aidar"]);
  await worlds.load();
  const original = worlds.current.id;
  const second = await worlds.create();
  second.name = "Другое место";
  second.laws = "Всё происходит в реальном времени.";
  second.characters[0].name = "Лео";
  second.characters[0].voice = "custom-voice";
  await worlds.save(second);
  await worlds.activate(original);
  assert.equal(worlds.current.name, "Малый космос");
  await worlds.activate(second.id);
  assert.equal(worlds.current.name, "Другое место");
  assert.equal(worlds.current.characters[0].voice, "custom-voice");
  assert.equal((await worlds.list()).worlds.length, 2);
  await assert.rejects(worlds.activate("../world"));
});
