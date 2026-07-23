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
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "CharmIPTV API");
  assert.equal(body.status, "online");
  assert.deepEqual(body.endpoints, ["/config", "/channels", "/guide", "/channel/{id}"]);
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
  const body = await response.json();
  assert.equal(body.ready, true);
  assert.equal(body.channelCount, 12);
  assert.equal(body.guideAvailable, false);
  assert.deepEqual(body.announcements, []);
});

test("config returns a clear error when KV config is invalid", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/config"),
    environment({ config: "not-json" }),
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "bad_config", ready: false });
});

test("channels returns a temporary unavailable response before KV is populated", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/channels"),
    environment(),
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "not_ready");
});
