import { bad, validateSettings } from "./stories.mjs";
import { lore } from "./creative.mjs";
export const ideaSchema = {
  type: "object",
  additionalProperties: false,
  properties: { idea: { type: "string" } },
  required: ["idea"],
};
export function ideaSettings(input, w) {
  if (
    !input ||
    !Array.isArray(input.heroes) ||
    typeof input.prompt !== "string" ||
    input.prompt.length > 2500
  )
    throw bad("Проверь параметры идеи.");
  const s = validateSettings(
    {
      ...input,
      prompt: "Новая идея",
      heroes: input.heroes.length ? input.heroes : [w.characters[0].id],
    },
    w,
  );
  return {
    ...s,
    heroes: input.heroes.length ? s.heroes : [],
    previousPrompt: input.prompt,
  };
}
export function ideaMessages(w, s, recent = []) {
  const characters = s.heroes.length
    ? w.characters.filter((c) => s.heroes.includes(c.id))
    : w.characters;
  return [
    {
      role: "system",
      content: `Придумай одну НОВУЮ конкретную завязку для короткой истории на русском. 1–3 предложения, максимум 800 символов. Желание героя, бытовое действие и неожиданное следствие существующего закона мира. Без полного сценария, вступлений и объяснения шутки. Не изобретай новые законы или персонажей. Используй только перечисленных жителей. Верни только JSON: {"idea":"завязка"}. ЛОР: ${lore({ ...w, characters })}`,
    },
    {
      role: "user",
      content: JSON.stringify({
        place: s.place,
        format: s.format,
        duration: s.duration,
        mood: { absurd: s.absurd, warmth: s.warmth, dread: s.dread },
        ending: s.ending,
        constraints: s.constraints,
        avoid: [s.previousPrompt, ...recent].filter(Boolean),
        instruction:
          "Придумай другую ситуацию, не пересказывай и не продолжай примеры из avoid.",
      }),
    },
  ];
}
export function parseIdea(raw) {
  let v;
  try {
    v = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    throw bad("Модель не завершила идею. Попробуй ещё раз.");
  }
  if (typeof v?.idea !== "string" || !v.idea.trim() || v.idea.length > 800)
    throw bad(
      "Модель вернула пустую или слишком длинную идею. Попробуй ещё раз.",
    );
  return v.idea.trim();
}
