import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
export async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return structuredClone(fallback);
    throw e;
  }
}
export async function writeJSON(file, value, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + "." + randomUUID() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), { mode });
  await fs.rename(tmp, file);
  await fs.chmod(file, mode);
}
export const exists = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};
export const pythonIn = (folder) =>
  path.join(
    folder,
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
export function serial() {
  let chain = Promise.resolve();
  return (fn) => {
    const task = chain.then(fn, fn);
    chain = task.catch(() => {});
    return task;
  };
}
