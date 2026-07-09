var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.ts
var HF = "https://huggingface.co";
var ALLOWED_PREFIXES = [
  "onnx-community/embeddinggemma-300m-ONNX/",
  "onnx-community/gemma-4-E2B-it-ONNX/"
];
var BUFFER_LIMIT = 10 * 1024 * 1024;
var BACKUP_MAX_BYTES = 50 * 1024 * 1024;
var BACKUP_ID_RE = /^[0-9a-f]{64}$/;
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/models/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405 });
      }
      return serveModel(url, request, env, ctx);
    }
    if (url.pathname.startsWith("/api/backup/")) {
      return serveBackup(url, request, env);
    }
    return env.ASSETS.fetch(request);
  }
};
async function serveBackup(url, request, env) {
  const id = url.pathname.slice("/api/backup/".length);
  if (!BACKUP_ID_RE.test(id)) return new Response("Bad id", { status: 400 });
  const key = `backups/${id}.bin`;
  if (request.method === "PUT") {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (!length || length > BACKUP_MAX_BYTES) {
      return new Response("Payload too large", { status: 413 });
    }
    const body = await request.arrayBuffer();
    if (body.byteLength > BACKUP_MAX_BYTES) {
      return new Response("Payload too large", { status: 413 });
    }
    await env.MODELS.put(key, body, {
      customMetadata: { uploaded: (/* @__PURE__ */ new Date()).toISOString() }
    });
    return new Response(null, { status: 204 });
  }
  if (request.method === "GET" || request.method === "HEAD") {
    const obj = await env.MODELS.get(key);
    if (!obj) return new Response("Not found", { status: 404 });
    const headers = new Headers({
      "content-type": "application/octet-stream",
      "content-length": String(obj.size),
      "cache-control": "no-store",
      "x-backup-uploaded": obj.customMetadata?.uploaded ?? ""
    });
    return new Response(request.method === "HEAD" ? null : obj.body, { headers });
  }
  return new Response("Method not allowed", { status: 405 });
}
__name(serveBackup, "serveBackup");
function fileHeaders(contentType, size) {
  const headers = new Headers({
    "content-type": contentType ?? "application/octet-stream",
    "cache-control": "public, max-age=31536000, immutable",
    "access-control-allow-origin": "*",
    "accept-ranges": "bytes"
  });
  if (size !== void 0) headers.set("content-length", String(size));
  return headers;
}
__name(fileHeaders, "fileHeaders");
function parseRange(header) {
  const m = /^bytes=(\d+)-(\d*)$/.exec(header ?? "");
  if (!m) return null;
  return { start: Number(m[1]), end: m[2] ? Number(m[2]) : null };
}
__name(parseRange, "parseRange");
async function primeFromUpstream(key, hfPath, env) {
  const upstream = await fetch(`${HF}/${hfPath}`);
  if (!upstream.ok || !upstream.body) return false;
  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const length = Number(upstream.headers.get("content-length") ?? 0);
  if (!length) return false;
  if (length <= BUFFER_LIMIT) {
    await env.MODELS.put(key, await upstream.arrayBuffer(), { httpMetadata: { contentType } });
  } else {
    await env.MODELS.put(key, upstream.body.pipeThrough(new FixedLengthStream(length)), {
      httpMetadata: { contentType }
    });
  }
  return true;
}
__name(primeFromUpstream, "primeFromUpstream");
async function serveModel(url, request, env, ctx) {
  const hfPath = url.pathname.slice("/models/".length);
  const key = hfPath.replace(/\/resolve\/[^/]+\//, "/");
  if (!ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method === "HEAD") {
    const head = await env.MODELS.head(key);
    if (head) {
      return new Response(null, { headers: fileHeaders(head.httpMetadata?.contentType, head.size) });
    }
    const upstream2 = await fetch(`${HF}/${hfPath}`, { method: "HEAD" });
    if (!upstream2.ok) return new Response(`Upstream ${upstream2.status}`, { status: 502 });
    const len = Number(upstream2.headers.get("content-length") ?? 0);
    return new Response(null, {
      headers: fileHeaders(
        upstream2.headers.get("content-type") ?? void 0,
        len > 0 ? len : void 0
      )
    });
  }
  const range = parseRange(request.headers.get("range"));
  if (range) {
    let head = await env.MODELS.head(key);
    if (!head) {
      if (!await primeFromUpstream(key, hfPath, env)) {
        return fetch(`${HF}/${hfPath}`, { headers: { range: request.headers.get("range") } });
      }
      head = await env.MODELS.head(key);
      if (!head) return new Response("Prime failed", { status: 502 });
    }
    const end = Math.min(range.end ?? head.size - 1, head.size - 1);
    if (range.start > end) return new Response("Range not satisfiable", { status: 416 });
    const length2 = end - range.start + 1;
    const obj = await env.MODELS.get(key, { range: { offset: range.start, length: length2 } });
    if (!obj) return new Response("Not found", { status: 404 });
    const headers = fileHeaders(obj.httpMetadata?.contentType, length2);
    headers.set("content-range", `bytes ${range.start}-${end}/${head.size}`);
    return new Response(obj.body, { status: 206, headers });
  }
  const cached = await env.MODELS.get(key);
  if (cached) {
    return new Response(cached.body, { headers: fileHeaders(cached.httpMetadata?.contentType, cached.size) });
  }
  const upstream = await fetch(`${HF}/${hfPath}`);
  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream ${upstream.status}`, { status: 502 });
  }
  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const length = Number(upstream.headers.get("content-length") ?? 0);
  if (length > 0 && length <= BUFFER_LIMIT) {
    const buf = await upstream.arrayBuffer();
    ctx.waitUntil(env.MODELS.put(key, buf, { httpMetadata: { contentType } }));
    return new Response(buf, { headers: fileHeaders(contentType, buf.byteLength) });
  }
  if (length > 0) {
    const [toStore, toClient] = upstream.body.tee();
    ctx.waitUntil(
      env.MODELS.put(key, toStore.pipeThrough(new FixedLengthStream(length)), {
        httpMetadata: { contentType }
      })
    );
    return new Response(toClient, { headers: fileHeaders(contentType, length) });
  }
  return new Response(upstream.body, { headers: fileHeaders(contentType) });
}
__name(serveModel, "serveModel");

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

// .wrangler/tmp/bundle-eBeC5V/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

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

// .wrangler/tmp/bundle-eBeC5V/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
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
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
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
