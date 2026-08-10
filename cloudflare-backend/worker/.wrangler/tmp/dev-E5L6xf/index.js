var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-Tw9ISI/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// src/index.js
function corsHeaders(env, request) {
  const allowed = String(env.CORS_ALLOW_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request?.headers?.get?.("Origin") || "";
  const headers = {
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type"
  };
  if (!allowed.length)
    return headers;
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
__name(corsHeaders, "corsHeaders");
function jsonResponse(obj, { status = 200, maxAge = 300, cors = {} } = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=86400`,
      ...cors
    }
  });
}
__name(jsonResponse, "jsonResponse");
async function serveGzip(env, key, acceptEncoding, maxAge, cors) {
  const buf = await env.KV.get(key, "arrayBuffer");
  if (!buf) {
    return jsonResponse(
      { error: "not_ready", message: "Data is still being built. Try again shortly." },
      { status: 503, maxAge: 15, cors }
    );
  }
  const wantsGzip = (acceptEncoding || "").toLowerCase().includes("gzip");
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=86400`,
    vary: "Accept-Encoding",
    ...cors
  };
  if (wantsGzip) {
    headers["content-encoding"] = "gzip";
    return new Response(buf, { status: 200, headers });
  }
  const stream = new Response(buf).body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream, { status: 200, headers });
}
__name(serveGzip, "serveGzip");
async function servePlainJsonFromGzip(env, key, maxAge, cors) {
  const buf = await env.KV.get(key, "arrayBuffer");
  if (!buf) {
    return jsonResponse(
      { error: "not_ready", message: "Data is still being built. Try again shortly." },
      { status: 503, maxAge: 15, cors }
    );
  }
  const stream = new Response(buf).body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=86400`,
      ...cors
    }
  });
}
__name(servePlainJsonFromGzip, "servePlainJsonFromGzip");
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
        ready: false
      },
      { maxAge: 60, cors }
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
        ready: Boolean(config.ready)
      },
      { maxAge: 60, cors }
    );
  } catch {
    return jsonResponse({ error: "bad_config", ready: false }, { status: 500, maxAge: 15, cors });
  }
}
__name(serveConfig, "serveConfig");
async function serveChannel(env, id, cors) {
  const text = await env.KV.get("windows");
  if (!text)
    return jsonResponse({ error: "not_ready" }, { status: 503, maxAge: 15, cors });
  let map;
  try {
    map = JSON.parse(text);
  } catch {
    return jsonResponse({ error: "bad_data" }, { status: 500, cors });
  }
  const ch = map[id];
  if (!ch)
    return jsonResponse({ error: "not_found", id }, { status: 404, cors });
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
  const shape = /* @__PURE__ */ __name((p) => p ? { title: p.t, start: p.s, stop: p.e, category: p.c || null } : null, "shape");
  return jsonResponse(
    {
      id,
      name: ch.n,
      logo: ch.l || null,
      category: ch.g || null,
      now: shape(current),
      next: shape(next),
      serverTime: now
    },
    { maxAge: 60, cors }
  );
}
__name(serveChannel, "serveChannel");
var src_default = {
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
            endpoints: ["/config", "/channels", "/guide", "/channels.json", "/guide.json", "/channel/{id}"]
          },
          { maxAge: 30, cors }
        );
      }
      if (path === "/config")
        return await serveConfig(env, cors);
      if (path === "/channels")
        return await serveGzip(env, "channels_gz", ae, 1800, cors);
      if (path === "/guide")
        return await serveGzip(env, "guide_gz", ae, 1800, cors);
      if (path === "/channels.json")
        return await servePlainJsonFromGzip(env, "channels_gz", 1800, cors);
      if (path === "/guide.json")
        return await servePlainJsonFromGzip(env, "guide_gz", 1800, cors);
      const m = path.match(/^\/channel\/(.+)$/);
      if (m)
        return await serveChannel(env, decodeURIComponent(m[1]), cors);
      return jsonResponse({ error: "not_found", path }, { status: 404, maxAge: 30, cors });
    } catch (e) {
      return jsonResponse({ error: "server_error", detail: String(e) }, { status: 500, maxAge: 5, cors });
    }
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-Tw9ISI/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-Tw9ISI/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
