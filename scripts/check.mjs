import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
for (const dir of [".", "lib", "scripts", "tests", "public"])
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isFile() && /\.(mjs|js)$/.test(entry.name)) {
      const p = dir + "/" + entry.name;
      const r = spawnSync(process.execPath, ["--check", p], {
        stdio: "inherit",
      });
      if (r.status) process.exit(r.status);
    }
  }
console.log("JavaScript syntax: OK");
