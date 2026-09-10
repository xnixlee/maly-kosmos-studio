import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import path from "node:path";
export class Worker {
  constructor(python, script, root, env = {}) {
    Object.assign(this, {
      python,
      script,
      root,
      env,
      child: null,
      pending: new Map(),
      log: "",
    });
  }
  boot() {
    if (this.child) return this.child;
    const child = spawn(this.python, ["-u", this.script], {
      cwd: this.root,
      env: { ...process.env, ...this.env, PYTHONDONTWRITEBYTECODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stderr.on("data", (b) => (this.log = (this.log + b).slice(-10000)));
    const fail = (e) => {
      if (this.child !== child) return;
      this.child = null;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(e);
      }
      this.pending.clear();
    };
    child.on("error", (e) =>
      fail(new Error("Не удалось запустить локальный движок: " + e.message)),
    );
    child.on("exit", (code) => {
      if (code) console.error(this.log);
      fail(new Error("Движок остановлен. Задачу можно повторить."));
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.stage) {
        p.stage(m.stage);
        return;
      }
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      if (m.error) {
        console.error(this.log);
        p.reject(new Error(m.error));
      } else p.resolve(m.result);
    });
    return child;
  }
  call(data, stage = () => {}) {
    return new Promise((resolve, reject) => {
      const child = this.boot(),
        id = randomUUID();
      const timer = setTimeout(() => {
        this.stop();
        reject(
          new Error(
            "Движок не закончил за 10 минут. Попробуй более короткий текст.",
          ),
        );
      }, 600000);
      this.pending.set(id, { resolve, reject, timer, stage });
      child.stdin.write(JSON.stringify({ ...data, id }) + "\n", (e) => {
        if (e) {
          this.stop();
          reject(e);
        }
      });
    });
  }
  stop() {
    const child = this.child;
    this.child = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Задача остановлена."));
    }
    this.pending.clear();
    child?.kill();
  }
}
export function makeEngines(root, config) {
  return {
    text: new Worker(
      config.textPython,
      path.join(root, "scripts/story-worker.py"),
      root,
    ),
    voice: new Worker(
      config.voice.python,
      path.join(root, "scripts/voice-worker.py"),
      root,
      {
        VOICE_ASSETS_ROOT: config.voice.assetsRoot,
        VOICE_VENDOR: config.voice.vendor,
        STUDIO_OUTPUT: path.join(config.data, "audio"),
        NUMBA_CACHE_DIR: path.join(config.data, "numba"),
        MPLCONFIGDIR: path.join(config.data, "matplotlib"),
        OMP_NUM_THREADS: "4",
        HF_HUB_OFFLINE: "1",
      },
    ),
  };
}
