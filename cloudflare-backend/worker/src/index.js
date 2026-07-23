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
 *   GET /config          GET /channels          GET /guide          GET /channel/{id}
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Content-Type",
};

function jsonResponse(obj, { status = 200, maxAge = 300 } = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=86400`,
      ...CORS,
    },
  });
}

// Serve pre-gzipped bytes from KV. Return gzip when the client supports it;
// otherwise stream a decompressed copy.
async function serveGzip(env, key, acceptEncoding, maxAge) {
  const buf = await env.KV.get(key, "arrayBuffer");
  if (!buf) {
    return jsonResponse(
      { error: "not_ready", message: "Data is still being built. Try again shortly." },
      { status: 503, maxAge: 15 },
    );
  }

  const wantsGzip = (acceptEncoding || "").toLowerCase().includes("gzip");
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=86400`,
    vary: "Accept-Encoding",
    ...CORS,
  };

  if (wantsGzip) {
    headers["content-encoding"] = "gzip";
    return new Response(buf, { status: 200, headers });
  }

  const stream = new Response(buf).body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream, { status: 200, headers });
}

async function serveConfig(env) {
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
      { maxAge: 60 },
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
      { maxAge: 60 },
    );
  } catch {
    return jsonResponse({ error: "bad_config", ready: false }, { status: 500, maxAge: 15 });
  }
}

// Current + next program for one channel, computed at request time.
async function serveChannel(env, id) {
  const text = await env.KV.get("windows");
  if (!text) return jsonResponse({ error: "not_ready" }, { status: 503, maxAge: 15 });

  let map;
  try {
    map = JSON.parse(text);
  } catch {
    return jsonResponse({ error: "bad_data" }, { status: 500 });
  }

  const ch = map[id];
  if (!ch) return jsonResponse({ error: "not_found", id }, { status: 404 });

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
    { maxAge: 60 },
  );
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
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
            endpoints: ["/config", "/channels", "/guide", "/channel/{id}"],
          },
          { maxAge: 30 },
        );
      }
      if (path === "/config") return await serveConfig(env);
      if (path === "/channels") return await serveGzip(env, "channels_gz", ae, 1800);
      if (path === "/guide") return await serveGzip(env, "guide_gz", ae, 1800);

      const m = path.match(/^\/channel\/(.+)$/);
      if (m) return await serveChannel(env, decodeURIComponent(m[1]));

      return jsonResponse({ error: "not_found", path }, { status: 404, maxAge: 30 });
    } catch (e) {
      return jsonResponse({ error: "server_error", detail: String(e) }, { status: 500, maxAge: 5 });
    }
  },
};
