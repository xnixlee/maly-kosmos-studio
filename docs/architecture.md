# Architecture

- `server.mjs`: single-user HTTP API, one heavy job at a time, cancellation, media ranges and atomic story saves.
- `lib/models.mjs`: data-driven connections, model catalog, readiness, managed/external storage boundaries, installation jobs.
- `lib/openai.mjs`: Responses adapter, server-side credentials, strict story schema, persistent usage ledger and accounting.
- `lib/engines.mjs`: cancellable JSON-lines workers for local text and speech.
- `lib/worlds.mjs`: editable independent worlds, import/export and activation.
- `lib/stories.mjs`: prompt construction, parameter validation, scenario parsing, speech chunking and exports.
- `scripts/story-worker.py`: local MLX inference with remote tokenizer code disabled.
- `scripts/voice-worker.py`: Silero, optional per-role RVC conversion, Whisper/Stable-ts alignment and per-model cache.
- `scripts/install-engine.mjs`, `scripts/install-model.py`: separate runtime setup and pinned model downloads.
- `public/`: buildless browser application, model settings and OpenAI cabinet. No external fonts, scripts or analytics.

Local Python workers release one another's models when switching between text and speech. OpenAI calls use no local text worker. Story versions store the selected settings and a snapshot of lore; rewriting uses that snapshot. Editing speech invalidates the previously attached audio. A stale concurrent save returns 409 rather than overwriting newer edits.

The default data and model stores are ignored directories next to the code; environment variables can place them outside the checkout. This makes cloning/pulling code independent from model weights, private keys and user output. Model profile source paths and secret stores are not served as static files.
