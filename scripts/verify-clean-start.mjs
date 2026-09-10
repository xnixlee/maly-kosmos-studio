import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, ".."),
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "cosmos-clean-"));
const port = 4323,
  base = "http://127.0.0.1:" + port;
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    STUDIO_DATA_DIR: path.join(dir, "data"),
    STUDIO_MODELS_DIR: path.join(dir, "models"),
    OPENAI_API_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (output += b));
try {
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(base + "/api/bootstrap");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, output);
  const b = await fetch(base + "/api/bootstrap").then((r) => r.json());
  assert.equal(b.status.model, false);
  assert.equal(b.status.voice, false);
  assert.equal(b.account.profiles.length, 0);
  assert.equal(b.worlds.worlds.length, 1);
  for (const route of [
    "/",
    "/app.js",
    "/settings.js",
    "/account.js",
    "/style.css",
    "/api/account",
    "/api/models",
    "/api/worlds",
  ])
    assert.equal((await fetch(base + route)).status, 200, route);
  for (const route of [
    "/data/accounts.json",
    "/data/secrets/key.json",
    "/.env",
    "/models/source.json",
  ])
    assert.equal((await fetch(base + route)).status, 404, route);
  console.log(
    "PASS: clean local startup without models or keys; all application modules served; private paths inaccessible",
  );
} finally {
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  await fs.rm(dir, { recursive: true, force: true });
}
