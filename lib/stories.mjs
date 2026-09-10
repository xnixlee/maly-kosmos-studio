import { randomUUID } from "node:crypto";
export function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
const str = (s, max) => typeof s === "string" && s.length <= max;
export function validateWorld(
  w,
  voiceIds = [
    "aidar",
    "eugene",
    "kseniya",
    "spongebob",
    "cartman",
    "zhirinovsky",
  ],
) {
  if (
    !w ||
    !str(w.name, 100) ||
    !w.name.trim() ||
    !str(w.premise, 5000) ||
    !str(w.style, 5000) ||
    !str(w.laws, 12000) ||
    !Array.isArray(w.places) ||
    !w.places.length ||
    w.places.length > 30 ||
    w.places.some((x) => !str(x, 120) || !x.trim()) ||
    !Array.isArray(w.characters) ||
    !w.characters.length ||
    w.characters.length > 20
  )
    throw bad("Проверь описание мира: до 20 героев и 30 мест.");
  const ids = new Set(),
    names = new Set();
  for (const c of w.characters) {
    if (
      !/^[a-z0-9-]{1,50}$/.test(c.id) ||
      ids.has(c.id) ||
      names.has(c.name) ||
      !str(c.name, 80) ||
      !c.name.trim() ||
      !str(c.role, 150) ||
      !str(c.description, 3500) ||
      !str(c.voice, 80)
    )
      throw bad("Проверь имя, характер и голос каждого героя.");
    if (
      c.portraitData &&
      (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
        c.portraitData,
      ) ||
        c.portraitData.length > 500000)
    )
      throw bad("Портрет должен быть небольшим PNG, JPEG или WebP.");
    ids.add(c.id);
    names.add(c.name);
    if (
      c.portrait !== null &&
      (!Number.isInteger(c.portrait) || c.portrait < 0 || c.portrait > 5)
    )
      c.portrait = null;
  }
  if (w.narrator !== undefined && !str(w.narrator, 3000))
    throw bad("Описание рассказчика слишком длинное.");
  if (
    w.ideas !== undefined &&
    (!Array.isArray(w.ideas) ||
      w.ideas.length > 100 ||
      w.ideas.some((x) => !str(x, 2000)))
  )
    throw bad("До 100 завязок по 2000 символов.");
  return structuredClone(w);
}
export function validateSettings(s, w) {
  if (
    !s ||
    !str(s.prompt, 2500) ||
    !s.prompt.trim() ||
    !str(s.constraints ?? "", 2000)
  )
    throw bad("Напиши завязку: от 1 до 2500 символов.");
  if (
    !Array.isArray(s.heroes) ||
    !s.heroes.length ||
    s.heroes.length > 6 ||
    s.heroes.some((id) => !w.characters.some((c) => c.id === id))
  )
    throw bad("Выбери от одного до шести героев.");
  if (
    !w.places.includes(s.place) ||
    !["episode", "dialogue", "lore"].includes(s.format) ||
    ![30, 45, 60, 90].includes(Number(s.duration)) ||
    ![1, 3, 5].includes(Number(s.count))
  )
    throw bad("Проверь место, формат и длительность.");
  const result = { ...s, heroes: [...new Set(s.heroes)] };
  for (const [k, min, max, def] of [
    ["absurd", 0, 100, 70],
    ["warmth", 0, 100, 50],
    ["dread", 0, 100, 20],
    ["temperature", 0.1, 1.4, 0.85],
    ["seed", 0, 2147483647, Math.floor(Math.random() * 2147483647)],
  ]) {
    const v = s[k] == null || s[k] === "" ? def : Number(s[k]);
    if (
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (k === "seed" && !Number.isInteger(v))
    )
      throw bad("Некорректная настройка: " + k);
    result[k] = v;
  }
  if (
    ![
      "Визуальный панчлайн",
      "Тёплое открытие",
      "Тревожная деталь",
      "Открытый финал",
    ].includes(s.ending)
  )
    throw bad("Выбери развязку.");
  result.count = Number(s.count);
  result.duration = Number(s.duration);
  return result;
}
export function messages(w, s, recent = [], rewrite = null) {
  const selected = w.characters
    .filter((c) => s.heroes.includes(c.id))
    .map(({ name, description }) => ({ name, description }));
  return [
    {
      role: "system",
      content: `Ты сценарист оригинальных русскоязычных историй вселенной «${w.name}». Пиши живым грамотным русским языком. ${w.premise}\nРАССКАЗЧИК: ${w.narrator || "Наблюдатель, не всезнающий."}\nСТИЛЬ: ${w.style}\nЗАКОНЫ: ${w.laws}\nГЕРОИ: ${JSON.stringify(selected)}\nПокажи желание героя, одно физическое правило, последствия и развязку через действие. Не объясняй шутку. Сначала причина, затем действие, затем видимый результат. Простые короткие русские предложения. Без лирических сравнений, образного тумана и новых чудес в каждом кадре. Герои говорят о конкретных вещах, как обычные соседи. В описании кадра только то, что камера действительно покажет. Не добавляй свойств предметам и существам, которых нет в описании мира или пожеланиях автора. Не копируй чужие сериалы. Не придумывай новые законы ради удобства сюжета. Только выбранные персонажи и Рассказчик.\nВерни ТОЛЬКО JSON, без markdown и вступлений. Формат: {"title":"Название","logline":"О чём история, одно предложение","continuity":"Какой закон мира использован и что важно сохранить","scenes":[{"speaker":"Рассказчик или точное имя выбранного героя","text":"Только произносимый текст, без ремарок","visual":"Что видно в кадре, конкретное действие","sound":"Звук и паузы","imagePrompt":"English image prompt for this shot, following the appearance and visual style in the world description. No captions or text."}]}. Все поля обязательны. От 4 до 6 сцен. visual — одно-два ясных предложения, sound — короткая строка со звуками. Финал показывает последствие выбора героя, а не объясняет мораль. Пример интонации: «Он спрятался за деревом. Дерево было тоньше его фонаря. Соседи старались не смотреть». Это образец языка, не сюжет для копирования. У сцены один говорящий. Одна реплика не длиннее 280 символов. Вся история должна иметь завершение.`,
    },
    {
      role: "user",
      content: `Завязка: ${s.prompt}\nМесто: ${s.place}\nФормат: ${{ episode: "Короткий эпизод с рассказчиком", dialogue: "Диалог персонажей, минимум рассказчика", lore: "Маленький случай, раскрывающий обычай мира" }[s.format]}\nДлительность около ${s.duration} секунд: ВСЕГО ${Math.round(s.duration * 1.6)}–${Math.round(s.duration * 2)} русских слов для озвучки на все сцены.\nАбсурд ${s.absurd}/100, теплота ${s.warmth}/100, тревога ${s.dread}/100. Развязка: ${s.ending}.\nПожелания: ${s.constraints || "Нет дополнительных."}\nЭти истории уже были, не повторяй их: ${recent
        .slice(0, 8)
        .map((x) => x.title + ": " + x.logline)
        .join(
          "; ",
        )}\n${rewrite ? `Перепиши существующий сценарий по замечанию: ${rewrite.instruction}\nСуществующий сценарий: ${JSON.stringify(rewrite.story)}` : ""}`,
    },
  ];
}
export function parseStory(raw, w, s) {
  const start = raw.indexOf("{"),
    end = raw.lastIndexOf("}");
  if (start < 0 || end < start)
    throw new Error("Модель не вернула сценарий в нужном формате.");
  let value;
  try {
    value = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("Модель оборвала структуру сценария.");
  }
  if (
    !value ||
    !str(value.title, 160) ||
    !value.title.trim() ||
    !str(value.logline, 1000) ||
    !str(value.continuity, 2000) ||
    !Array.isArray(value.scenes) ||
    value.scenes.length < 1 ||
    value.scenes.length > 15
  )
    throw new Error("Неполная структура сценария.");
  const speakers = [
    "Рассказчик",
    ...w.characters.filter((c) => s.heroes.includes(c.id)).map((c) => c.name),
  ];
  for (const scene of value.scenes) {
    if (
      scene.imagePrompt === undefined &&
      typeof scene.image_prompt === "string"
    )
      scene.imagePrompt = scene.image_prompt;
    for (const k of ["visual", "sound", "imagePrompt"])
      if (
        Array.isArray(scene[k]) &&
        scene[k].every((x) => typeof x === "string")
      )
        scene[k] = scene[k].join("; ");
    for (const k of ["speaker", "text", "visual", "sound", "imagePrompt"])
      if (!str(scene[k], k === "text" ? 1500 : 2500))
        throw new Error(
          "Поле " +
            k +
            " в сцене должно быть строкой. Все сцены содержат speaker, text, visual, sound, imagePrompt.",
        );
    if (!scene.text.trim()) throw new Error("В сцене пустая реплика.");
    if (!speakers.includes(scene.speaker))
      throw new Error("Модель добавила невыбранного героя: " + scene.speaker);
  }
  return value;
}
export function record(story, settings) {
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    revision: 1,
    title: story.title,
    logline: story.logline,
    engine: "Qwen3 4B · локально",
    settings,
    story,
  };
}
export function markdown(r) {
  return `# ${r.story.title}\n\n${r.story.logline}\n\n${r.engine} · зерно ${r.settings.seed}\n\n${r.story.scenes.map((s, i) => `## Кадр ${i + 1}\n\n**${s.speaker}:** ${s.text}\n\nКартинка: ${s.visual}\n\nЗвук: ${s.sound}\n\nПромпт: ${s.imagePrompt}`).join("\n\n")}\n\n## Связь с миром\n\n${r.story.continuity}\n`;
}
export function splitSpeech(text) {
  const words = text.trim().split(/\s+/),
    parts = [];
  let chunk = "";
  for (const word of words) {
    if (word.length > 280) throw bad("Слишком длинное слово для озвучки.");
    if ((chunk + " " + word).trim().length > 280) {
      parts.push(chunk);
      chunk = word;
    } else chunk = (chunk + " " + word).trim();
  }
  if (chunk) parts.push(chunk);
  return parts;
}
