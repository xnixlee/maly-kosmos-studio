# OpenAI accounting

References checked 2026-09-11:

- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/prompt-caching
- https://developers.openai.com/api/docs/guides/structured-outputs

Every generation creates a pending usage record before sending a request. When a response arrives, its usage is saved before parsing the scenario. Malformed, refused, and incomplete outputs can still incur charges. Connection loss, cancellation, process interruption or unavailable usage are recorded as unknown; no charge is invented and no automatic paid retry occurs.

For input `I`, cached reads `C`, writes `W`, output `O`, and per-million prices:

`cost = ((I-C-W)*input + C*cachedInput + W*cacheWrite + O*output) / 1,000,000`

Cache writes are a separate subset of input tokens. Reasoning is already included in the API's total output count and must not be added again. Above 272,000 input tokens the long-context rates apply to the whole request. Requests specify the standard tier; accounting uses the returned tier when present. Unknown tiers or inconsistent usage yield unknown cost.

Money is stored as integer nanodollars plus a display USD value. Each entry stores its tariff snapshot, verification date, response ID when available, model, key fingerprint and job ID. Raw keys and prompt contents are not in the usage ledger. Totals are local studio usage, not prepaid credit balances, invoices or organization-wide usage. The official dashboard remains the billing authority.
