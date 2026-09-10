# Contributing

Use Node.js 22+. Run `npm ci`, `npm run check` and `npm test` before proposing a change. Model weights and an OpenAI account are not required for the unit tests.

Keep providers separate from story/world logic. Preserve saved records when changing schemas, add migration tests, and keep old usage entries priced with the rate snapshot captured for that request. Never retry paid calls silently or represent missing usage as zero.

Model catalog changes should include a public source, full commit/revision, supported runtime, and clear license information. Avoid committing binary weights, Python environments, private model paths, generated personal outputs, API keys, or test fixtures containing real credentials.

Browser strings are in Russian. Escape all model/user content before HTML rendering. Use the same validators and actions for UI and API flows. Keep custom lore out of the engine implementation.
