import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const url = "http://127.0.0.1:" + Number(process.env.PORT || 4321);
const isReady = async () => {
  try {
    const r = await fetch(url + "/api/bootstrap", {
      signal: AbortSignal.timeout(1000),
    });
    const b = await r.json();
    return r.ok && b.models && b.world;
  } catch {
    return false;
  }
};
if (await isReady()) {
  spawn("open", [url], { stdio: "ignore" });
} else {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code || 0));
  for (let i = 0; i < 30; i++) {
    if (await isReady()) {
      spawn("open", [url], { stdio: "ignore" });
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
