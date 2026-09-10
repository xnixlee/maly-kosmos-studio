import { bad } from "./stories.mjs";
export const imageModels = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
export const imageDefaults = {
  provider: "openai",
  model: imageModels[0],
  quality: "low",
  size: "1536x1024",
  style: "",
};
export function imageSettings(input = {}) {
  const s = { ...imageDefaults, ...input };
  if (
    s.provider !== "openai" ||
    !imageModels.includes(s.model) ||
    !["low", "medium", "high", "xhigh", "max"].includes(s.quality) ||
    !["1024x1024", "1536x1024", "1024x1536"].includes(s.size) ||
    typeof s.style !== "string" ||
    s.style.length > 2000
  )
    throw bad("Проверь модель, размер, качество и стиль изображения.");
  return Object.fromEntries(Object.keys(imageDefaults).map((k) => [k, s[k]]));
}
export const characterFields = {
  name: ["Имя", 80],
  role: ["Роль в мире", 150],
  appearance: ["Внешность и силуэт", 500],
  personality: ["Характер и противоречие", 400],
  desire: ["Чего хочет", 300],
  flaw: ["Слабость", 300],
  habits: ["Повадки и манера речи", 300],
  relationships: ["Связи с жителями", 500],
  hooks: ["Завязки с этим героем", 400],
  canon: ["Связь с законами мира", 400],
  imagePrompt: ["Промпт портрета", 1800],
  voice: ["Голос", 80],
};
export function characterSchema(voices) {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(characterFields),
    properties: Object.fromEntries(
      Object.keys(characterFields).map((k) => [
        k,
        k === "voice" ? { type: "string", enum: voices } : { type: "string" },
      ]),
    ),
  };
}
export function parseCharacter(raw, voices) {
  let c;
  try {
    c =
      typeof raw === "string"
        ? JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1))
        : raw;
  } catch {
    throw bad(
      "Модель не завершила карточку персонажа. Попробуй более короткое описание.",
    );
  }
  if (
    !c ||
    Object.entries(characterFields).some(
      ([k, [, max]]) =>
        typeof c[k] !== "string" || !c[k].trim() || c[k].length > max,
    ) ||
    !voices.includes(c.voice)
  )
    throw bad(
      "Карточка персонажа неполная или слишком длинная. Сократи запрос и повтори.",
    );
  return Object.fromEntries(
    Object.keys(characterFields).map((k) => [k, c[k].trim()]),
  );
}
export function characterDescription(c) {
  return Object.entries(characterFields)
    .filter(([k]) => !["name", "role", "imagePrompt", "voice"].includes(k))
    .map(([k, [label]]) => `${label}: ${c[k]}`)
    .join("\n");
}
export function lore(w) {
  return JSON.stringify({
    name: w.name,
    premise: w.premise,
    style: w.style,
    laws: w.laws,
    places: w.places,
    characters: w.characters.map(({ name, role, description }) => ({
      name,
      role,
      description,
    })),
  });
}
export function characterMessages(w, brief, voices) {
  return [
    {
      role: "system",
      content: `Придумай нового самобытного персонажа строго по лору. Это предложение автору, не новый канон. Не меняй законы мира. Свяжи героя с существующими жителями и физическими правилами; дай конкретное желание, слабость, смешную повадку и три завязки. Не повторяй имена. Русский язык, imagePrompt на английском. Верни только JSON по схеме ${JSON.stringify(characterSchema(voices))}. Лимиты символов: ${JSON.stringify(characterFields)}. ЛОР: ${lore(w)}`,
    },
    { role: "user", content: brief },
  ];
}
export function scenePrompt(w, record, scene, settings) {
  const cast = w.characters.filter((c) =>
    record.settings.heroes.includes(c.id),
  );
  return `Create one finished story frame. No captions, lettering, borders or collage. Keep recurring character designs consistent. Show only characters present in this scene. Reference images, when attached, show these characters in order: ${cast
    .filter((c) => c.portraitData)
    .map((c) => c.name)
    .join(
      ", ",
    )}.\nWORLD: ${lore({ ...w, characters: cast })}\nVISUAL DIRECTION: ${settings.style}\nSTORY: ${record.story.title}. ${record.story.logline}\nSCENE: ${scene.visual}\nSPOKEN CONTEXT: ${scene.text}\nSHOT PROMPT: ${scene.imagePrompt}`;
}
export function portraitPrompt(w, c, settings) {
  return `Design a single full-body character portrait, head to feet visible, readable silhouette, simple setting from their world. No text, panels or labels. WORLD: ${lore(w)}\nART DIRECTION: ${settings.style}\nCHARACTER: ${JSON.stringify(c)}\nFollow the character's appearance and world rules. This is a new character design, not a copy of existing residents.`;
}
export function calculateImageCost(usage, rate) {
  const d = usage?.input_tokens_details;
  if (!usage || !d || !rate) return null;
  const input = usage.input_tokens,
    output = usage.output_tokens,
    text = d.text_tokens,
    image = d.image_tokens,
    cached = d.cached_tokens ?? 0;
  if (
    [input, output, text, image, cached].some(
      (n) => !Number.isSafeInteger(n) || n < 0,
    ) ||
    text + image !== input
  )
    return null;
  // Unknown cache modality cannot be priced honestly at one blended rate.
  const ct =
      d.cached_tokens_details?.text_tokens ?? (cached === 0 ? 0 : undefined),
    ci =
      d.cached_tokens_details?.image_tokens ?? (cached === 0 ? 0 : undefined);
  if (
    ![ct, ci].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    ct + ci !== cached ||
    ct > text ||
    ci > image
  )
    return null;
  if (
    ![
      rate.textInput,
      rate.cachedTextInput,
      rate.imageInput,
      rate.cachedImageInput,
      rate.imageOutput,
    ].every((n) => Number.isFinite(n) && n >= 0)
  )
    return null;
  const nanoUSD = Math.round(
    ((text - ct) * rate.textInput +
      ct * rate.cachedTextInput +
      (image - ci) * rate.imageInput +
      ci * rate.cachedImageInput +
      output * rate.imageOutput) *
      1000,
  );
  return { nanoUSD, usd: nanoUSD / 1e9, input, output, cached, kind: "image" };
}
