const DEFAULT_QUEUE_COUNT = 500;
const DEFAULT_USAGE_LIMIT = 5000;
const AUTH_COOKIE = "cts_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const PASSWORD_ITERATIONS = 100000;

let schemaReady;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'custom',
    tag TEXT NOT NULL DEFAULT 'imported',
    input_price REAL NOT NULL DEFAULT 0,
    output_price REAL NOT NULL DEFAULT 0,
    cache_price REAL NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS usage_logs (
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
  )`,
  "CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_logs(ts)",
  "CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_logs(model)",
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS auth_users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (username) REFERENCES auth_users(username) ON UPDATE CASCADE ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS idx_auth_sessions_username ON auth_sessions(username)",
  "CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at)",
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
      try {
        return cors(await handleApi(request, env, ctx));
      } catch (error) {
        return cors(json({ error: error.message || "Internal error" }, error.status || 500));
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

  if (request.method === "GET" && path === "/api/auth/status") {
    return json(await authStatus(db, request));
  }

  if (request.method === "POST" && path === "/api/auth/setup") {
    const body = await request.json();
    return setupAuth(db, body);
  }

  if (request.method === "POST" && path === "/api/auth/login") {
    const body = await request.json();
    return loginAuth(db, body);
  }

  if (request.method === "POST" && path === "/api/auth/logout") {
    return logoutAuth(db, request);
  }

  if (request.method === "PUT" && path === "/api/auth/profile") {
    const session = await requireAdmin(request, env, db);
    const body = await request.json();
    return updateAuthProfile(db, session, body);
  }

  if (request.method === "GET" && path === "/api/state") {
    const [models, logs, meta] = await Promise.all([
      listModels(db),
      listUsage(db, numberFrom(url.searchParams.get("limit"), DEFAULT_USAGE_LIMIT)),
      listMeta(db),
    ]);
    return json({ models, logs, meta });
  }

  if (request.method === "PUT" && path === "/api/display-balance") {
    await requireAdmin(request, env, db);
    const body = await request.json();
    const balance = numberFrom(body?.balance, NaN);
    if (!Number.isFinite(balance) || balance < 0) return json({ error: "Invalid balance" }, 400);
    const normalized = Math.round(balance * 100) / 100;
    await setMeta(db, "display_balance", String(normalized));
    return json({ status: "ok", balance: normalized });
  }

  if (request.method === "GET" && path === "/api/models") {
    return json({ data: await listModels(db) });
  }

  if (request.method === "GET" && path === "/api/cliproxy-models") {
    return json(await fetchCliProxyModels(env));
  }

  if (request.method === "PUT" && path === "/api/models") {
    await requireAdmin(request, env, db);
    const body = await request.json();
    const models = normalizeModels(body?.models ?? body?.data ?? body);
    await replaceModels(db, models);
    return json({ status: "ok", count: models.length });
  }

  if (request.method === "GET" && path === "/api/usage") {
    return json({ data: await listUsage(db, numberFrom(url.searchParams.get("limit"), DEFAULT_USAGE_LIMIT)) });
  }

  if (request.method === "POST" && path === "/api/usage") {
    await requireAdmin(request, env, db);
    const payload = await request.json();
    const logs = normalizeUsagePayload(payload);
    const result = await insertUsageLogs(db, logs);
    return json(result);
  }

  if (request.method === "POST" && path === "/api/ingest") {
    await requireAdmin(request, env, db);
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
    schemaReady = (async () => {
      for (const statement of SCHEMA_STATEMENTS) {
        await db.prepare(statement).run();
      }
    })();
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
  const headers = buildCliProxyHeaders(env, { includeApiKey: false });

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

function buildCliProxyHeaders(env, { includeApiKey = true } = {}) {
  const headers = new Headers({ accept: "application/json" });
  const apiKey = String(env.CLIPROXY_API_KEY || "").trim();
  if (includeApiKey && apiKey) headers.set("Authorization", apiKey.toLowerCase().startsWith("bearer ") ? apiKey : `Bearer ${apiKey}`);

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

async function authStatus(db, request) {
  const configured = await hasAuthUser(db);
  const session = await getSessionUser(db, request);
  return {
    configured,
    user: session ? publicUser(session) : null,
    session: session ? { loggedInAt: session.loggedInAt, expiresAt: session.expiresAt } : null,
  };
}

async function setupAuth(db, body) {
  if (await hasAuthUser(db)) return json({ error: "Auth is already configured" }, 409);
  const username = cleanUsername(body?.username);
  const password = String(body?.password || "");
  validateCredentials(username, password);

  const passwordHash = await hashPassword(password);
  await db.prepare(`
    INSERT INTO auth_users (username, password_hash, created_at, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(username, passwordHash).run();

  return issueSessionResponse(db, username, 201);
}

async function loginAuth(db, body) {
  const username = cleanUsername(body?.username);
  const password = String(body?.password || "");
  const user = await getAuthUser(db, username);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return json({ error: "Invalid username or password" }, 401);
  }
  return issueSessionResponse(db, username);
}

async function logoutAuth(db, request) {
  const token = getCookie(request, AUTH_COOKIE);
  if (token) {
    await db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  }
  const response = json({ status: "ok" });
  response.headers.append("Set-Cookie", clearAuthCookie());
  return response;
}

async function updateAuthProfile(db, session, body) {
  const currentPassword = String(body?.currentPassword || "");
  const nextPassword = String(body?.nextPassword || "");
  const nextUsername = cleanUsername(body?.username);
  validateUsername(nextUsername);

  const user = await getAuthUser(db, session.username);
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return json({ error: "Current password is incorrect" }, 401);
  }

  const passwordHash = nextPassword ? await hashPassword(nextPassword) : user.passwordHash;
  if (nextPassword) validatePassword(nextPassword);

  if (nextUsername !== session.username && await getAuthUser(db, nextUsername)) {
    return json({ error: "Username is already in use" }, 409);
  }

  await db.batch([
    db.prepare(`
      UPDATE auth_users
      SET username = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE username = ?
    `).bind(nextUsername, passwordHash, session.username),
    db.prepare(`
      UPDATE auth_sessions
      SET username = ?
      WHERE username = ?
    `).bind(nextUsername, session.username),
  ]);

  const nextSession = await getSessionUserByHash(db, session.tokenHash);
  return json({
    configured: true,
    user: publicUser(nextSession),
    session: { loggedInAt: nextSession.loggedInAt, expiresAt: nextSession.expiresAt },
  });
}

async function hasAuthUser(db) {
  const row = await db.prepare("SELECT username FROM auth_users LIMIT 1").first();
  return Boolean(row);
}

async function getAuthUser(db, username) {
  if (!username) return null;
  const row = await db.prepare(`
    SELECT username, password_hash, created_at, updated_at
    FROM auth_users
    WHERE username = ?
  `).bind(username).first();
  if (!row) return null;
  return {
    username: row.username,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getSessionUser(db, request) {
  const token = getCookie(request, AUTH_COOKIE);
  if (!token) return null;
  return getSessionUserByHash(db, await sha256Hex(token));
}

async function getSessionUserByHash(db, tokenHash) {
  const row = await db.prepare(`
    SELECT s.token_hash, s.username, s.created_at AS logged_in_at, s.expires_at,
           u.created_at AS user_created_at, u.updated_at AS user_updated_at
    FROM auth_sessions s
    JOIN auth_users u ON u.username = s.username
    WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now')
  `).bind(tokenHash).first();
  if (!row) return null;
  return {
    tokenHash: row.token_hash,
    username: row.username,
    loggedInAt: row.logged_in_at,
    expiresAt: row.expires_at,
    createdAt: row.user_created_at,
    updatedAt: row.user_updated_at,
  };
}

async function issueSessionResponse(db, username, status = 200) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await db.prepare(`
    INSERT INTO auth_sessions (token_hash, username, created_at, expires_at)
    VALUES (?, ?, CURRENT_TIMESTAMP, ?)
  `).bind(tokenHash, username, expiresAt).run();

  const session = await getSessionUserByHash(db, tokenHash);
  const response = json({
    configured: true,
    user: publicUser(session),
    session: { loggedInAt: session.loggedInAt, expiresAt: session.expiresAt },
  }, status);
  response.headers.append("Set-Cookie", authCookie(token, SESSION_MAX_AGE_SECONDS));
  return response;
}

function publicUser(user) {
  if (!user) return null;
  return {
    username: user.username,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function validateCredentials(username, password) {
  validateUsername(username);
  validatePassword(password);
}

function validateUsername(username) {
  if (!username || username.length < 2 || username.length > 64) {
    throw httpError("Username must be 2-64 characters", 400);
  }
}

function validatePassword(password) {
  if (!password || password.length < 6) {
    throw httpError("Password must be at least 6 characters", 400);
  }
}

function cleanUsername(value) {
  return String(value || "").trim();
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2$${PASSWORD_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

async function verifyPassword(password, stored) {
  const [kind, iterationsText, saltHex, hashHex] = String(stored || "").split("$");
  if (kind !== "pbkdf2" || !iterationsText || !saltHex || !hashHex) return false;
  const hash = await pbkdf2(password, hexToBytes(saltHex), Number(iterationsText) || PASSWORD_ITERATIONS);
  return timingSafeEqual(bytesToHex(hash), hashHex);
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function randomHex(length) {
  return bytesToHex(randomBytes(length));
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function timingSafeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let diff = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const prefix = `${name}=`;
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) || "";
}

function authCookie(token, maxAge) {
  return `${AUTH_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function clearAuthCookie() {
  return `${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function normalizeModels(payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  return list.map((item) => {
    const id = typeof item === "string" ? item : String(item?.id ?? item?.name ?? item?.model ?? "").trim();
    if (!id) return null;
    return {
      id,
      provider: cleanProviderName(item?.provider ?? item?.owned_by ?? inferProvider(id)),
      tag: String(item?.tag ?? item?.group ?? item?.category ?? sourceTag(item?.owned_by ?? item?.provider)).trim(),
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
    provider: cleanProviderName(row.provider ?? row.channel ?? row.channel_name ?? inferProvider(model)),
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

async function requireAdmin(request, env, db) {
  const token = String(env.ADMIN_TOKEN || "").trim();
  const auth = request.headers.get("Authorization") || "";
  const headerToken = request.headers.get("X-Admin-Token") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (token && (bearer === token || headerToken === token)) return { username: "admin-token" };
  const session = await getSessionUser(db, request);
  if (session) return session;
  throw httpError("Unauthorized", 401);
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

function cleanProviderName(value) {
  const text = String(value || "").trim();
  if (!text) return "custom";
  if (/^https?:\/\//i.test(text)) {
    try {
      return new URL(text).hostname.replace(/^www\./, "");
    } catch {
      return text;
    }
  }
  return text;
}

function sourceTag(value) {
  const text = String(value || "").trim();
  if (!text) return "imported";
  if (/^https?:\/\//i.test(text)) return "url-source";
  const lower = text.toLowerCase();
  if (lower.includes("nvidia")) return "nvidia";
  if (lower.includes("openai")) return "openai";
  if (lower.includes("google")) return "google";
  if (lower.includes("antigravity")) return "antigravity";
  if (text.includes("公益")) return "公益站";
  return "imported";
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

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cors(response) {
  const next = new Response(response.body, response);
  next.headers.set("Access-Control-Allow-Origin", "*");
  next.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  next.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
  return next;
}
