import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";

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
  assert.deepEqual(body.endpoints, ["/config", "/channels", "/guide", "/channels.json", "/guide.json", "/channel/{id}"]);
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
  assert.equal(body.channelsWithGuide, 0);
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

test("plain app endpoints return uncompressed JSON even when the client asks for gzip", async () => {
  const channels = [{ id: "AETV.us", name: "A&E", url: "https://example.test/live.m3u8" }];
  const response = await worker.fetch(
    new Request("https://example.test/channels.json", {
      headers: { "Accept-Encoding": "gzip" },
    }),
    environment({ channels_gz: gzipSync(Buffer.from(JSON.stringify(channels))) }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-encoding"), null);
  assert.deepEqual(await response.json(), channels);
});

test("worker does not reflect internal exception details", async () => {
  const secret = "provider-token-must-not-leak";
  const response = await worker.fetch(
    new Request("https://example.test/config"),
    { KV: { async get() { throw new Error(secret); } } },
  );

  assert.equal(response.status, 500);
  const text = await response.text();
  assert.equal(text.includes(secret), false);
  assert.deepEqual(JSON.parse(text), {
    error: "server_error",
    message: "Request could not be completed",
  });
});

test("worker ignores wildcard CORS configuration", async () => {
  const env = environment();
  env.CORS_ALLOW_ORIGINS = "*";
  const response = await worker.fetch(
    new Request("https://example.test/health", { headers: { Origin: "https://untrusted.test" } }),
    env,
  );
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});
