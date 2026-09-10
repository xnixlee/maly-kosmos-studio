import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  kind = process.argv[2];
const pythonIn = (p) =>
  path.join(
    p,
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
async function run(cmd, args, cwd = root) {
  await new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(cmd + " exited " + code)),
    );
  });
}
async function has(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
async function setup(engine) {
  if (
    ["text", "rvc"].includes(engine) &&
    !(process.platform === "darwin" && process.arch === "arm64")
  )
    throw new Error(
      "Для MLX и RVC нужен Mac с Apple Silicon. OpenAI работает без них.",
    );
  const dir = path.join(root, engine === "text" ? ".venv" : ".venv-neural");
  if (!(await has(pythonIn(dir)))) {
    const python =
      process.env.PYTHON_BIN ||
      (process.platform === "win32" ? "python" : "python3.11");
    await run(python, [
      "-c",
      "import sys;assert (3,11)<=sys.version_info[:2]<(3,13), 'Use Python 3.11 or 3.12'",
    ]);
    await run(python, ["-m", "venv", dir]);
  }
  await run(pythonIn(dir), [
    "-m",
    "pip",
    "install",
    "-r",
    path.join(
      root,
      engine === "text"
        ? "requirements-text.lock.txt"
        : "requirements-voice.txt",
    ),
  ]);
  if (engine === "rvc") {
    await run(pythonIn(dir), ["-m", "pip", "install", "mlx==0.32.2"]);
    const vendor = path.join(root, "vendor/rvc-mlx");
    if (!(await has(vendor))) {
      await fs.mkdir(path.dirname(vendor), { recursive: true });
      await run("git", [
        "clone",
        "https://github.com/Acelogic/Retrieval-based-Voice-Conversion-MLX.git",
        vendor,
      ]);
    }
    await run(
      "git",
      ["checkout", "eec7791a59eb09d0f56f1189df55e9852848e692"],
      vendor,
    );
  }
  console.log("Движок установлен.");
}
try {
  if (kind === "request") {
    const filename = process.argv[3],
      r = JSON.parse(await fs.readFile(filename));
    if (r.kind !== "model") await setup(r.kind);
    else {
      const python = r.model.kind === "mlx" ? r.textPython : r.voice.python;
      if (!(await has(python)))
        throw new Error("Сначала установи соответствующий движок.");
      await run(python, [
        path.join(root, "scripts/install-model.py"),
        filename,
      ]);
    }
  } else await setup(kind);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
