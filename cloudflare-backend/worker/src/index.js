/**
 * Charm IPTV - Cloudflare Worker API (Free-plan friendly).
 *
 * This Worker is a thin, fast serve layer. It never parses M3U/XML. All heavy
 * parsing is done every 6h by the GitHub Actions job (scripts/build-and-upload.mjs),
 * which writes pre-built, gzipped JSON into KV. The Worker just hands it back.
 *
 * KV keys written by the builder:
 *   config      -> small JSON string   (version, maintenance, announcements, lastUpdated)
 *   channels_gz -> gzip bytes of JSON  (channel list the app needs)
 *   guide_gz    -> gzip bytes of JSON  (optimized guide, matched per channel)
 *   windows     -> JSON string         ({ [channelId]: { n, l, g, p:[{t,s,e,c}] } })
 *
 * Endpoints:
 *   GET /config          GET /channels          GET /guide          GET /channels.json
 *   GET /guide.json      GET /channel/{id}
 *
 * CORS: set Worker secret/var CORS_ALLOW_ORIGINS to a comma-separated list of
 * allowed Origin values (e.g. https://app.example.com). Leave empty to omit
 * Access-Control-Allow-Origin (native apps do not need CORS). Never default to *.
 */

function corsHeaders(env, request) {
  const allowed = String(env.CORS_ALLOW_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = request?.headers?.get?.("Origin") || "";
  const headers = {
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type",
  };
  if (!allowed.length) return headers;
  if (allowed.includes("*")) {
    headers["access-control-allow-origin"] = "*";
    return headers;
  }
  if (origin && allowed.includes(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return headers;
}

function jsonResponse(obj, { status = 200, maxAge = 300, cors = {} } = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=86400`,
      ...cors,
    },
  });
}

// Serve pre-gzipped bytes from KV. Return gzip when the client supports it;
// otherwise stream a decompressed copy.
async function serveGzip(env, key, acceptEncoding, maxAge, cors) {
  const buf = await env.KV.get(key, "arrayBuffer");
  if (!buf) {
    return jsonResponse(
      { error: "not_ready", message: "Data is still being built. Try again shortly." },
      { status: 503, maxAge: 15, cors },
    );
  }

  const wantsGzip = (acceptEncoding || "").toLowerCase().includes("gzip");
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=86400`,
    vary: "Accept-Encoding",
    ...cors,
  };

  if (wantsGzip) {
    headers["content-encoding"] = "gzip";
    return new Response(buf, { status: 200, headers });
  }

  const stream = new Response(buf).body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream, { status: 200, headers });
}

// Mobile/TV apps can be inconsistent about automatically decoding gzip from
// fetch(). These endpoints always return plain JSON, no matter what headers the
// device sends.
async function servePlainJsonFromGzip(env, key, maxAge, cors) {
  const buf = await env.KV.get(key, "arrayBuffer");
  if (!buf) {
    return jsonResponse(
      { error: "not_ready", message: "Data is still being built. Try again shortly." },
      { status: 503, maxAge: 15, cors },
    );
  }

  const stream = new Response(buf).body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=86400`,
      ...cors,
    },
  });
}

async function serveConfig(env, cors) {
  const text = await env.KV.get("config");
  if (!text) {
    return jsonResponse(
      {
        version: "1.0.0",
        maintenance: false,
        announcements: [],
        lastUpdated: null,
        channelCount: 0,
        channelsWithGuide: 0,
        guideAvailable: false,
        ready: false,
      },
      { maxAge: 60, cors },
    );
  }

  try {
    const config = JSON.parse(text);
    return jsonResponse(
      {
        version: config.version || "1.0.0",
        maintenance: Boolean(config.maintenance),
        announcements: Array.isArray(config.announcements) ? config.announcements : [],
        lastUpdated: config.lastUpdated || null,
        channelCount: Number.isFinite(config.channelCount) ? config.channelCount : 0,
        channelsWithGuide: Number.isFinite(config.channelsWithGuide) ? config.channelsWithGuide : 0,
        guideAvailable: Boolean(config.guideAvailable),
        ready: Boolean(config.ready),
      },
      { maxAge: 60, cors },
    );
  } catch {
    return jsonResponse({ error: "bad_config", ready: false }, { status: 500, maxAge: 15, cors });
  }
}

// Current + next program for one channel, computed at request time.
async function serveChannel(env, id, cors) {
  const text = await env.KV.get("windows");
  if (!text) return jsonResponse({ error: "not_ready" }, { status: 503, maxAge: 15, cors });

  let map;
  try {
    map = JSON.parse(text);
  } catch {
    return jsonResponse({ error: "bad_data" }, { status: 500, cors });
  }

  const ch = map[id];
  if (!ch) return jsonResponse({ error: "not_found", id }, { status: 404, cors });

  const now = Date.now();
  const progs = ch.p || [];
  let current = null;
  let next = null;

  for (let i = 0; i < progs.length; i++) {
    const p = progs[i];
    if (p.s <= now && now < p.e) {
      current = p;
      next = progs[i + 1] || null;
      break;
    }
    if (p.s > now) {
      next = p;
      break;
    }
  }

  const shape = (p) =>
    p ? { title: p.t, start: p.s, stop: p.e, category: p.c || null } : null;

  return jsonResponse(
    {
      id,
      name: ch.n,
      logo: ch.l || null,
      category: ch.g || null,
      now: shape(current),
      next: shape(next),
      serverTime: now,
    },
    { maxAge: 60, cors },
  );
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const ae = request.headers.get("Accept-Encoding") || "";

    try {
      if (path === "/" || path === "/health") {
        return jsonResponse(
          {
            ok: true,
            service: "CharmIPTV API",
            status: "online",
            endpoints: ["/config", "/channels", "/guide", "/channels.json", "/guide.json", "/channel/{id}"],
          },
          { maxAge: 30, cors },
        );
      }
      if (path === "/config") return await serveConfig(env, cors);
      if (path === "/channels") return await serveGzip(env, "channels_gz", ae, 1800, cors);
      if (path === "/guide") return await serveGzip(env, "guide_gz", ae, 1800, cors);
      if (path === "/channels.json") return await servePlainJsonFromGzip(env, "channels_gz", 1800, cors);
      if (path === "/guide.json") return await servePlainJsonFromGzip(env, "guide_gz", 1800, cors);

      const m = path.match(/^\/channel\/(.+)$/);
      if (m) return await serveChannel(env, decodeURIComponent(m[1]), cors);

      return jsonResponse({ error: "not_found", path }, { status: 404, maxAge: 30, cors });
    } catch (e) {
      return jsonResponse({ error: "server_error", detail: String(e) }, { status: 500, maxAge: 5, cors });
    }
  },
};
