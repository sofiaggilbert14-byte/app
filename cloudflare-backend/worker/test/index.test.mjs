import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

function environment(values = {}) {
  return {
    KV: {
      async get(key, type) {
        const value = values[key] ?? null;
        if (value === null || type !== "arrayBuffer") return value;
        return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      },
    },
  };
}

test("health endpoint identifies the service", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/health"),
    environment(),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "charm-iptv-api" });
});

test("config reports not ready before the first data refresh", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/config"),
    environment(),
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).ready, false);
});

test("config serves the data builder status from KV", async () => {
  const config = JSON.stringify({ ready: true, channelCount: 12 });
  const response = await worker.fetch(
    new Request("https://example.test/config"),
    environment({ config }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ready: true, channelCount: 12 });
});

test("channels returns a temporary unavailable response before KV is populated", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/channels"),
    environment(),
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "not_ready");
});
