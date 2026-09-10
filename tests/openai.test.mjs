import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { calculateCost, OpenAIService } from "../lib/openai.mjs";
const root = path.resolve(import.meta.dirname, "..");
const pricing = JSON.parse(
  await fs.readFile(path.join(root, "config/pricing.json")),
);
const rate = pricing.models["gpt-5.6-luna"];
test("billing splits uncached, cached, writes and output without double-counting", () => {
  const x = calculateCost(
    {
      input_tokens: 1000,
      input_tokens_details: { cached_tokens: 400, cache_write_tokens: 100 },
      output_tokens: 200,
    },
    rate,
  );
  assert.equal(x.nanoUSD, 373000);
  assert.equal(x.usd, 0.000373);
  assert.equal(x.ordinaryInput, 500);
});
test("long context threshold and returned service tier affect the complete request", () => {
  const usage = { input_tokens: 272001, output_tokens: 100 };
  assert.equal(calculateCost(usage, rate).nanoUSD, 108980400);
  assert.equal(calculateCost(usage, rate, "priority").nanoUSD, 217960800);
  assert.equal(calculateCost(usage, rate, "flex").nanoUSD, 54490200);
  assert.equal(calculateCost(usage, rate, "unknown"), null);
});
test("absent or inconsistent usage has unknown cost, never fabricated zero", () => {
  assert.equal(calculateCost(null, rate), null);
  assert.equal(
    calculateCost(
      {
        input_tokens: 2,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens: 1,
      },
      rate,
    ),
    null,
  );
  assert.equal(
    calculateCost({ input_tokens: 0, output_tokens: 0 }, rate).usd,
    0,
  );
});
async function service(t, fetcher) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cosmos-account-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const svc = new OpenAIService(root, dir, fetcher, {});
  await svc.load();
  await svc.add({ name: "Test key", key: "test-only-not-a-real-key-12345" });
  return { svc, dir };
}
test("key stays server-side and accounting persists on valid responses", async (t) => {
  let request;
  const { svc, dir } = await service(t, async (url, opts) => {
    request = { url, opts };
    return new Response(
      JSON.stringify({
        id: "resp_test",
        status: "completed",
        service_tier: "default",
        usage: {
          input_tokens: 1000,
          input_tokens_details: { cached_tokens: 400, cache_write_tokens: 100 },
          output_tokens: 200,
        },
        output: [
          { content: [{ type: "output_text", text: '{"title":"test"}' }] },
        ],
      }),
    );
  });
  const result = await svc.generate({
    messages: [{ role: "user", content: "test" }],
    speakers: ["Рассказчик"],
    jobId: "local-job",
  });
  assert.equal(result.cost.usd, 0.000373);
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  const payload = JSON.parse(request.opts.body);
  assert.equal(payload.model, "gpt-5.6-luna");
  assert.equal(payload.store, false);
  assert.equal(payload.text.format.strict, true);
  assert.equal(payload.service_tier, "default");
  const view = await svc.view();
  assert(!JSON.stringify(view).includes("test-only-not-a-real-key"));
  assert.equal(view.usage.usd, 0.000373);
  assert.equal(
    (await fs.stat(path.join(dir, "secrets", view.active + ".json"))).mode &
      0o777,
    0o600,
  );
  const second = new OpenAIService(root, dir, fetch, {});
  await second.load();
  assert.equal((await second.view()).usage.usd, 0.000373);
});
test("incomplete response is billed; connection loss is unknown; neither is silently retried", async (t) => {
  let calls = 0;
  const { svc } = await service(t, async () => {
    calls++;
    return new Response(
      JSON.stringify({
        id: "partial",
        status: "incomplete",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    );
  });
  await assert.rejects(
    svc.generate({ messages: [], speakers: ["Рассказчик"] }),
  );
  assert.equal(calls, 1);
  assert((await svc.view()).usage.usd > 0);
  svc.fetcher = async () => {
    calls++;
    throw new Error("connection lost");
  };
  await assert.rejects(
    svc.generate({ messages: [], speakers: ["Рассказчик"] }),
  );
  assert.equal(calls, 2);
  assert.equal((await svc.view()).usage.unknown, 1);
});
test("removing a key preserves historical usage and makes it unusable", async (t) => {
  const { svc } = await service(t, async () => new Response("{}"));
  const id = (await svc.view()).active;
  await svc.remove(id);
  await assert.rejects(svc.key(id));
  assert.equal((await svc.view()).profiles.length, 0);
});
