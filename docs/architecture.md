# Architecture

- `server.mjs`: single-user HTTP API, one heavy job at a time, cancellation, media ranges and atomic story saves.
- `lib/models.mjs`: data-driven connections, model catalog, readiness, managed/external storage boundaries, installation jobs.
- `lib/openai.mjs`: Responses and Images adapters, server-side credentials, strict story/character schemas, persistent usage ledger and accounting.
- `lib/engines.mjs`: cancellable JSON-lines workers for local text and speech.
- `lib/worlds.mjs`: editable independent worlds, import/export and activation.
- `lib/stories.mjs`: prompt construction, parameter validation, scenario parsing, speech chunking and exports.
- `scripts/story-worker.py`: local MLX inference with remote tokenizer code disabled.
- `scripts/voice-worker.py`: Silero, optional per-role RVC conversion, Whisper/Stable-ts alignment and per-model cache.
- `scripts/install-engine.mjs`, `scripts/install-model.py`: separate runtime setup and pinned model downloads.
- `public/`: buildless browser application, model settings and OpenAI cabinet. No external fonts, scripts or analytics.

Local Python workers release one another's models when switching between text and speech. OpenAI calls use no local text worker. Story versions store the selected settings and a snapshot of lore; rewriting uses that snapshot. Editing speech invalidates the previously attached audio. A stale concurrent save returns 409 rather than overwriting newer edits.

The default data and model stores are ignored directories next to the code; environment variables can place them outside the checkout. This makes cloning/pulling code independent from model weights, private keys and user output. Model profile source paths and secret stores are not served as static files.

- `lib/creative.mjs`: bounded image configuration, lore-aware character/scene prompts, character schema and multimodal pricing.
- `public/creative.js`: image controls, character drafts and central task history.
- `data/image-settings.json`: private image model, quality, size and art direction.
- `data/images/<job UUID>/<asset UUID>.png`: generated originals, ignored by Git; only strict UUID media routes are served. Character thumbnails are embedded in world exports for portability.

Image requests use the Images generation endpoint, or multipart edits when character portrait references are present. No remote image URLs or arbitrary fetch endpoints are accepted. Each generated asset stores source scene, settings, prompt and usage ID. Story images are attached under the story mutation lock without replacing concurrent text edits. Image variants survive story edits; original assets also remain available through task history. Deleting a story does not delete its image originals from the private data store.

Character generation snapshots lore and the target world. Acceptance appends one validated resident to that original world under a lock, preserving intervening edits, with a stable ID for idempotence. Portrait failure leaves the text draft recoverable. Regenerating a portrait creates a new draft/task with its own usage record.

Jobs expose stage labels, known completed units, timestamps and results. Public job views omit the internal character lore snapshot and repeated image prompts. The persisted history keeps 40 tasks and marks interrupted running tasks as errors on startup. There is one active heavy job, no queue. Paid requests are never automatically retried.

The authoring UI uses a dark studio canvas with a live world/cast preview when no story is open. The preview displays existing world artwork only for the bundled example; it does not represent generated story frames. Library covers use actual generated images when present and typographic covers otherwise. Inline outline SVGs are functional interface icons; no additional UI dependency or remote asset service is required.
