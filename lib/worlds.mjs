import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { readJSON, writeJSON, serial } from "./storage.mjs";
import { validateWorld, bad } from "./stories.mjs";
export class Worlds {
  constructor(data, seed, voiceIds) {
    this.data = data;
    this.seed = seed;
    this.voiceIds = voiceIds;
    this.lock = serial();
  }
  async load() {
    this.current = validateWorld(
      await readJSON(path.join(this.data, "world.json"), this.seed),
      this.voiceIds(),
    );
    this.current.id ||= "maly-kosmos";
    await this.save(this.current);
  }
  async save(w) {
    const v = validateWorld(w, this.voiceIds());
    v.id = this.current?.id || v.id || randomUUID();
    await this.lock(async () => {
      await writeJSON(path.join(this.data, "worlds", v.id + ".json"), v);
      await writeJSON(path.join(this.data, "world.json"), v);
      this.current = v;
    });
    return this.current;
  }
  async list() {
    const files = await fs.readdir(path.join(this.data, "worlds"));
    const worlds = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map((f) => readJSON(path.join(this.data, "worlds", f), null)),
    );
    return {
      currentId: this.current.id,
      worlds: worlds.filter(Boolean).map((w) => ({
        id: w.id,
        name: w.name,
        characters: w.characters.length,
      })),
    };
  }
  async create(w) {
    const id = randomUUID();
    const firstVoice = this.voiceIds()[0] || "aidar";
    const draft = w || {
      name: "Новая вселенная",
      premise: "",
      style: "",
      laws: "",
      places: ["Главная локация"],
      characters: [
        {
          id: "hero-" + randomUUID().slice(0, 8),
          name: "Главный герой",
          role: "",
          description: "",
          voice: firstVoice,
          portrait: null,
        },
      ],
      narrator: "Спокойный рассказчик",
      ideas: [],
    };
    const v = { ...validateWorld(draft, this.voiceIds()), id };
    await this.lock(async () => {
      await writeJSON(path.join(this.data, "worlds", id + ".json"), v);
      await writeJSON(path.join(this.data, "world.json"), v);
      this.current = v;
    });
    return this.current;
  }
  async addCharacter(id, character) {
    if (!/^(maly-kosmos|[a-f0-9-]{36})$/.test(id))
      throw bad("Мир не найден.", 404);
    return this.lock(async () => {
      const filename = path.join(this.data, "worlds", id + ".json");
      const w = await readJSON(filename, null);
      if (!w) throw bad("Мир не найден.", 404);
      if (w.characters.some((c) => c.id === character.id)) return w;
      w.characters.push(character);
      const v = validateWorld(w, this.voiceIds());
      await writeJSON(filename, v);
      if (this.current.id === id) {
        this.current = v;
        await writeJSON(path.join(this.data, "world.json"), v);
      }
      return v;
    });
  }
  async activate(id) {
    if (!/^(maly-kosmos|[a-f0-9-]{36})$/.test(id))
      throw bad("Мир не найден.", 404);
    const w = await readJSON(
      path.join(this.data, "worlds", id + ".json"),
      null,
    );
    if (!w) throw bad("Мир не найден.", 404);
    await this.lock(async () => {
      await writeJSON(path.join(this.data, "world.json"), w);
      this.current = w;
    });
    return w;
  }
}
