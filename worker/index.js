const DEFAULT_QUEUE_COUNT = 500;
const DEFAULT_USAGE_LIMIT = 5000;

let schemaReady;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
      try {
        return cors(await handleApi(request, env, ctx));
      } catch (error) {
        return cors(json({ error: error.message || "Internal error" }, 500));
      }
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(ingestUsageQueue(env));
  },
};

async function handleApi(request, env, ctx) {
  const db = getDb(env);
  await ensureSchema(db);

  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/health") {
    return json({ ok: true, hasDatabase: Boolean(env.DB), hasCliProxy: Boolean(env.CLIPROXY_BASE_URL) });
  }

  if (request.method === "GET" && path === "/api/state") {
    const [models, logs, meta] = await Promise.all([
      listModels(db),
      listUsage(db, numberFrom(url.searchParams.get("limit"), DEFAULT_USAGE_LIMIT)),
      listMeta(db),
    ]);
    return json({ models, logs, meta });
  }

  if (request.method === "GET" && path === "/api/models") {
    return json({ data: await listModels(db) });
  }

  if (request.method === "GET" && path === "/api/cliproxy-models") {
    return json(await fetchCliProxyModels(env));
  }

  if (request.method === "PUT" && path === "/api/models") {
    requireAdmin(request, env);
    const body = await request.json();
    const models = normalizeModels(body?.models ?? body?.data ?? body);
    await replaceModels(db, models);
    return json({ status: "ok", count: models.length });
  }

  if (request.method === "GET" && path === "/api/usage") {
    return json({ data: await listUsage(db, numberFrom(url.searchParams.get("limit"), DEFAULT_USAGE_LIMIT)) });
  }

  if (request.method === "POST" && path === "/api/usage") {
    requireAdmin(request, env);
    const payload = await request.json();
    const logs = normalizeUsagePayload(payload);
    const result = await insertUsageLogs(db, logs);
    return json(result);
  }

  if (request.method === "POST" && path === "/api/ingest") {
    requireAdmin(request, env);
    return json(await ingestUsageQueue(env));
  }

  return json({ error: "Not found" }, 404);
}

function getDb(env) {
  if (!env.DB) throw new Error("D1 binding DB is not configured");
  return env.DB;
}

async function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.exec(`
      CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'custom',
        tag TEXT NOT NULL DEFAULT 'imported',
        input_price REAL NOT NULL DEFAULT 0,
        output_price REAL NOT NULL DEFAULT 0,
        cache_price REAL NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS usage_logs (
        request_id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'custom',
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        status INTEGER NOT NULL DEFAULT 200,
        failed INTEGER NOT NULL DEFAULT 0,
        latency INTEGER NOT NULL DEFAULT 0,
        raw_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_logs(ts);
      CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_logs(model);

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
  return schemaReady;
}

async function listModels(db) {
  const { results } = await db.prepare(`
    SELECT id, provider, tag, input_price, output_price, cache_price, enabled
    FROM models
    ORDER BY id COLLATE NOCASE
  `).all();
  return results.map((row) => ({
    id: row.id,
    provider: row.provider,
    tag: row.tag,
    inputPrice: Number(row.input_price) || 0,
    outputPrice: Number(row.output_price) || 0,
    cachePrice: Number(row.cache_price) || 0,
    enabled: Boolean(row.enabled),
  }));
}

async function replaceModels(db, models) {
  const statements = [
    db.prepare("DELETE FROM models"),
    ...models.map((model) => db.prepare(`
      INSERT INTO models (id, provider, tag, input_price, output_price, cache_price, enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      model.id,
      model.provider || "custom",
      model.tag || "imported",
      numberFrom(model.inputPrice, 0),
      numberFrom(model.outputPrice, 0),
      numberFrom(model.cachePrice, 0),
      model.enabled === false ? 0 : 1,
    )),
  ];
  await db.batch(statements);
}

async function listUsage(db, limit) {
  const safeLimit = Math.max(1, Math.min(50000, Math.floor(limit || DEFAULT_USAGE_LIMIT)));
  const { results } = await db.prepare(`
    SELECT request_id, ts, provider, model, input_tokens, output_tokens, cached_tokens, total_tokens, status, failed, latency
    FROM usage_logs
    ORDER BY datetime(ts) DESC
    LIMIT ?
  `).bind(safeLimit).all();
  return results.map(rowToUsageLog);
}

async function insertUsageLogs(db, logs) {
  const rows = logs.filter((log) => log.model);
  if (!rows.length) return { status: "ok", received: 0, inserted: 0 };

  const statements = rows.map((log) => db.prepare(`
    INSERT OR IGNORE INTO usage_logs (
      request_id, ts, provider, model, input_tokens, output_tokens,
      cached_tokens, total_tokens, status, failed, latency, raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    log.requestId,
    log.ts,
    log.provider || inferProvider(log.model),
    log.model,
    log.inputTokens,
    log.outputTokens,
    log.cachedTokens,
    log.totalTokens,
    log.status,
    log.failed ? 1 : 0,
    log.latency,
    log.rawJson || null,
  ));

  const results = await db.batch(statements);
  const inserted = results.reduce((sum, result) => sum + (result.meta?.changes || 0), 0);
  return { status: "ok", received: rows.length, inserted };
}

async function ingestUsageQueue(env) {
  const db = getDb(env);
  await ensureSchema(db);

  const baseUrl = String(env.CLIPROXY_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    await setMeta(db, "last_ingest_error", "CLIPROXY_BASE_URL is not configured");
    return { status: "skipped", reason: "CLIPROXY_BASE_URL is not configured" };
  }

  const count = Math.max(1, Math.min(1000, numberFrom(env.USAGE_QUEUE_COUNT, DEFAULT_QUEUE_COUNT)));
  const url = `${baseUrl}/v0/management/usage-queue?count=${count}`;
  const headers = buildCliProxyHeaders(env);

  const response = await fetch(url, {
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const message = `CLIProxy usage queue HTTP ${response.status}: ${body.slice(0, 300)}`;
    await setMeta(db, "last_ingest_error", message);
    await setMeta(db, "last_ingest_at", new Date().toISOString());
    return { status: "error", error: message };
  }

  const payload = await response.json();
  const logs = normalizeUsagePayload(payload);
  const result = await insertUsageLogs(db, logs);
  await setMeta(db, "last_ingest_error", "");
  await setMeta(db, "last_ingest_at", new Date().toISOString());
  await setMeta(db, "last_ingest_received", String(result.received));
  await setMeta(db, "last_ingest_inserted", String(result.inserted));
  return { ...result, source: url };
}

async function fetchCliProxyModels(env) {
  const baseUrl = String(env.CLIPROXY_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("CLIPROXY_BASE_URL is not configured");

  const modelsPath = String(env.CLIPROXY_MODELS_PATH || "/v1/models").trim() || "/v1/models";
  const url = `${baseUrl}${modelsPath.startsWith("/") ? modelsPath : `/${modelsPath}`}`;
  const response = await fetch(url, {
    headers: buildCliProxyHeaders(env),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`CLIProxy models HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  return response.json();
}

function buildCliProxyHeaders(env) {
  const headers = new Headers({ accept: "application/json" });
  const apiKey = String(env.CLIPROXY_API_KEY || "").trim();
  if (apiKey) headers.set("Authorization", apiKey.toLowerCase().startsWith("bearer ") ? apiKey : `Bearer ${apiKey}`);

  const rawHeader = String(env.CLIPROXY_AUTH_HEADER || "").trim();
  if (rawHeader.includes(":")) {
    const [key, ...rest] = rawHeader.split(":");
    headers.set(key.trim(), rest.join(":").trim());
  }

  try {
    const extra = JSON.parse(env.CLIPROXY_HEADERS_JSON || "{}");
    Object.entries(extra).forEach(([key, value]) => headers.set(key, String(value)));
  } catch {
    // Ignore invalid optional header JSON.
  }

  return headers;
}

async function listMeta(db) {
  const { results } = await db.prepare("SELECT key, value FROM meta").all();
  return Object.fromEntries(results.map((row) => [row.key, row.value || ""]));
}

async function setMeta(db, key, value) {
  await db.prepare(`
    INSERT INTO meta (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).bind(key, value).run();
}

function normalizeModels(payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  return list.map((item) => {
    const id = typeof item === "string" ? item : String(item?.id ?? item?.name ?? item?.model ?? "").trim();
    if (!id) return null;
    return {
      id,
      provider: String(item?.provider ?? item?.owned_by ?? inferProvider(id)).trim().toLowerCase(),
      tag: String(item?.tag ?? item?.group ?? item?.category ?? "imported").trim(),
      inputPrice: numberFrom(item?.inputPrice ?? item?.input_price ?? item?.prompt_price, 0),
      outputPrice: numberFrom(item?.outputPrice ?? item?.output_price ?? item?.completion_price, 0),
      cachePrice: numberFrom(item?.cachePrice ?? item?.cache_price ?? item?.cached_price, 0),
      enabled: item?.enabled !== false,
    };
  }).filter(Boolean);
}

function normalizeUsagePayload(payload) {
  const rows = extractRows(payload);
  return rows.map(normalizeUsageRow).filter(Boolean);
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["data", "items", "queue", "usage", "logs", "records", "results"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return Object.values(payload).filter((value) => value && typeof value === "object");
}

function normalizeUsageRow(row) {
  if (!row || typeof row !== "object") return null;
  const usage = row.usage || row.token_usage || row.tokens || {};
  const model = String(row.model ?? row.model_name ?? row.name ?? row.request?.model ?? row.body?.model ?? "").trim();
  if (!model) return null;

  const inputTokens = integerFrom(row.inputTokens ?? row.input_tokens ?? row.prompt_tokens ?? usage.input_tokens ?? usage.prompt_tokens ?? usage.input, 0);
  const outputTokens = integerFrom(row.outputTokens ?? row.output_tokens ?? row.completion_tokens ?? usage.output_tokens ?? usage.completion_tokens ?? usage.output, 0);
  const cachedTokens = integerFrom(row.cachedTokens ?? row.cached_tokens ?? row.cache_read_input_tokens ?? usage.cached_tokens ?? usage.cache_read_input_tokens, 0);
  const totalTokens = integerFrom(row.totalTokens ?? row.total_tokens ?? usage.total_tokens, inputTokens + outputTokens);
  const status = integerFrom(row.status ?? row.status_code ?? row.code ?? row.response?.status, row.error ? 500 : 200);
  const ts = normalizeTimestamp(row.ts ?? row.timestamp ?? row.created_at ?? row.createdAt ?? row.time ?? row.date);
  const requestId = String(row.requestId ?? row.request_id ?? row.id ?? row.uuid ?? stableId({ ts, model, inputTokens, outputTokens, cachedTokens, totalTokens, status })).trim();
  const rawJson = safeJson(row);

  return {
    requestId,
    ts,
    provider: String(row.provider ?? row.channel ?? row.channel_name ?? inferProvider(model)).trim().toLowerCase(),
    model,
    inputTokens,
    outputTokens,
    cachedTokens,
    totalTokens,
    status,
    failed: Boolean(row.failed || row.error || status >= 400),
    latency: integerFrom(row.latency ?? row.latency_ms ?? row.duration ?? row.duration_ms, 0),
    rawJson,
  };
}

function rowToUsageLog(row) {
  return {
    requestId: row.request_id,
    ts: row.ts,
    provider: row.provider,
    model: row.model,
    inputTokens: Number(row.input_tokens) || 0,
    outputTokens: Number(row.output_tokens) || 0,
    cachedTokens: Number(row.cached_tokens) || 0,
    totalTokens: Number(row.total_tokens) || 0,
    status: Number(row.status) || 200,
    failed: Boolean(row.failed),
    latency: Number(row.latency) || 0,
  };
}

function requireAdmin(request, env) {
  const token = String(env.ADMIN_TOKEN || "").trim();
  if (!token) return;
  const auth = request.headers.get("Authorization") || "";
  const headerToken = request.headers.get("X-Admin-Token") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (bearer === token || headerToken === token) return;
  throw new Error("Unauthorized");
}

function normalizeTimestamp(value) {
  if (!value) return new Date().toISOString();
  if (typeof value === "number") {
    const ms = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function inferProvider(id) {
  const lower = String(id || "").toLowerCase();
  if (lower.includes("claude")) return "claude";
  if (lower.includes("gemini")) return "gemini";
  if (lower.includes("grok")) return "xai";
  if (lower.includes("gpt") || lower.includes("codex")) return "codex";
  if (lower.includes("deepseek")) return "deepseek";
  return "custom";
}

function numberFrom(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integerFrom(value, fallback) {
  return Math.max(0, Math.floor(numberFrom(value, fallback)));
}

function stableId(value) {
  const text = JSON.stringify(value);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return `auto-${Math.abs(hash).toString(36)}`;
}

function safeJson(value) {
  try {
    return JSON.stringify(value).slice(0, 8000);
  } catch {
    return null;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function cors(response) {
  const next = new Response(response.body, response);
  next.headers.set("Access-Control-Allow-Origin", "*");
  next.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  next.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
  return next;
}
