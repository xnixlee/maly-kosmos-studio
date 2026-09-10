import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { world, example } from "../lib/seed.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "http://127.0.0.1:4321";
const request = async (url, method = "GET", value) => {
  const r = await fetch(base + url, {
    method,
    headers: value ? { "Content-Type": "application/json" } : {},
    body: value ? JSON.stringify(value) : undefined,
  });
  return { status: r.status, data: await r.json() };
};
assert.equal((await fetch(base)).status, 200);
assert.equal(
  (
    await fetch(base + "/api/bootstrap", {
      headers: { Origin: "https://example.com" },
    })
  ).status,
  403,
);
assert.equal(
  (
    await request("/api/generate", "POST", {
      settings: { ...example.settings, heroes: [] },
    })
  ).status,
  400,
);
assert.equal(
  (await request("/api/world", "PUT", { name: "invalid" })).status,
  400,
);
assert.equal(
  (
    await request("/api/voice-preview", "POST", {
      voice: "spongebob",
      text: "я".repeat(301),
    })
  ).status,
  400,
);
const id = randomUUID();
const r = {
  ...structuredClone(example),
  id,
  title: "Проверка студии",
  worldSnapshot: world,
  createdAt: new Date().toISOString(),
};
r.story.title = r.title;
r.story.scenes = [
  {
    ...r.story.scenes[0],
    speaker: "Рассказчик",
    text: "Тропа снова на месте.",
  },
  { ...r.story.scenes[1], speaker: "Квазар", text: "Не закрывай калитку." },
];
await fs.writeFile(
  path.join(root, "data/stories", id + ".json"),
  JSON.stringify(r),
);
try {
  let saved = await request("/api/stories/" + id, "PUT", {
    story: r.story,
    revision: 1,
    voiceSettings: {
      voice: "eugene",
      speed: 1,
      pitch: 0,
      assignments: { Квазар: "spongebob" },
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.revision, 2);
  assert.equal(
    (
      await request("/api/stories/" + id, "PUT", {
        story: r.story,
        revision: 1,
      })
    ).status,
    409,
  );
  for (const format of ["json", "md", "txt"]) {
    const response = await fetch(
      base + `/api/stories/${id}/export?format=${format}`,
    );
    assert.equal(response.status, 200);
    assert((await response.text()).includes("Тропа снова на месте."));
  }
  const response = await request("/api/stories/" + id + "/audio", "POST", {
    voice: "eugene",
    speed: 1,
    pitch: 0,
    assignments: { Квазар: "spongebob" },
  });
  assert.equal(response.status, 202);
  console.log("AUDIO JOB", response.data.id);
  let j = response.data;
  const deadline = Date.now() + 480000;
  while (j.status === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    j = (await request("/api/jobs/" + j.id)).data;
  }
  assert.equal(j.status, "done", j.error);
  assert(j.audio.duration > 1);
  const audio = await fetch(base + j.audio.url, {
    headers: { Range: "bytes=0-43" },
  });
  assert.equal(audio.status, 206);
  assert.equal((await audio.arrayBuffer()).byteLength, 44);
  const subtitles = await fetch(base + j.audio.subtitles).then((r) => r.text());
  assert(subtitles.includes("Тропа"));
  assert(subtitles.includes("калитку"));
  const record = (await request("/api/stories/" + id)).data;
  assert(record.audio);
  record.story.scenes[0].text = "Теперь тропа снова на месте.";
  const changed = await request("/api/stories/" + id, "PUT", {
    story: record.story,
    revision: record.revision,
    voiceSettings: record.voiceSettings,
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.audio, undefined);
  console.log(
    "PASS: local boundary, validation, saving, conflicts, exports, two voices, WAV Range, SRT, audio invalidation",
  );
  await fs.writeFile(
    path.join(root, "data/verification.json"),
    JSON.stringify(
      { at: new Date().toISOString(), result: "passed", audio: j.audio },
      null,
      2,
    ),
  );
} finally {
  const del = await request("/api/stories/" + id, "DELETE");
  assert.equal(del.status, 200);
}
