const SESSIONS_KEY = "zhumengdao:sessions:v1";
const MAX_STORED_SESSIONS = 5000;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  if (req.body == null) return {};
  if (typeof req.body === "string") {
    const raw = req.body.trim();
    return raw ? JSON.parse(raw) : {};
  }
  if (Buffer.isBuffer(req.body)) {
    const raw = req.body.toString("utf8").trim();
    return raw ? JSON.parse(raw) : {};
  }
  if (typeof req.body === "object") return req.body;
  return {};
}

function toSafeString(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function toSafeText(value, max = 30000) {
  return String(value ?? "").slice(0, max);
}

function toSafeNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) {
    const error = new Error("Redis is not configured. Set REDIS_URL.");
    error.code = "KV_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  const Redis = require("ioredis");
  _redis = new Redis(url, { lazyConnect: false, enableReadyCheck: false, maxRetriesPerRequest: 2 });
  return _redis;
}

function normalizeSession(item) {
  if (!item || typeof item !== "object") return null;
  const createdAt = toSafeNumber(item.createdAt);
  const updatedAt = toSafeNumber(item.updatedAt);
  const config = item.config && typeof item.config === "object" ? item.config : {};
  const messages = Array.isArray(item.messages)
    ? item.messages.slice(0, 500).map((m) => ({
        role: ["user", "assistant"].includes(String(m?.role)) ? String(m.role) : "user",
        content: toSafeText(m?.content, 30000),
        source: m?.source ? toSafeString(m.source, 1) : undefined,
        time: m?.time ? toSafeString(m.time, 20) : undefined,
      }))
    : [];

  return {
    id: toSafeString(item.id, 120) || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: createdAt || Date.now(),
    updatedAt: updatedAt || Date.now(),
    roleId: toSafeString(item.roleId, 120),
    roleName: toSafeString(item.roleName, 120),
    systemPrompt: toSafeText(item.systemPrompt, 12000),
    temperature: (() => {
      const v = toSafeNumber(item.temperature);
      if (v == null) return 0;
      return Math.max(0, Math.min(2, v));
    })(),
    config: {
      modelA: toSafeString(config.modelA, 200),
      modelB: toSafeString(config.modelB, 200),
      endpointHostA: toSafeString(config.endpointHostA, 200),
      endpointHostB: toSafeString(config.endpointHostB, 200),
    },
    turnCount: Math.max(0, Math.floor(toSafeNumber(item.turnCount) || 0)),
    messages,
  };
}

async function readSessions() {
  const redis = getRedis();
  const raw = await redis.get(SESSIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSession).filter(Boolean);
  } catch {
    return [];
  }
}

async function writeSessions(sessions) {
  const normalized = sessions.map(normalizeSession).filter(Boolean).slice(0, MAX_STORED_SESSIONS);
  const redis = getRedis();
  await redis.set(SESSIONS_KEY, JSON.stringify(normalized));
  return normalized;
}

function sanitizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 200;
  return Math.min(1000, Math.floor(parsed));
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const id = urlObj.searchParams.get("id");
      const sessions = await readSessions();

      if (id) {
        const found = sessions.find((s) => s.id === id);
        if (!found) { sendJson(res, 404, { error: "Session not found" }); return; }
        sendJson(res, 200, { session: found });
        return;
      }

      const limit = sanitizeLimit(urlObj.searchParams.get("limit") || "200");
      sendJson(res, 200, { sessions: sessions.slice(0, limit), total: sessions.length });
      return;
    }

    if (req.method === "POST") {
      let body;
      try { body = parseBody(req); }
      catch (error) { sendJson(res, 400, { error: "Invalid JSON body", detail: String(error) }); return; }

      const session = normalizeSession(body?.session);
      if (!session) { sendJson(res, 400, { error: "Invalid session" }); return; }

      const sessions = await readSessions();
      const idx = sessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) { sessions[idx] = session; }
      else { sessions.unshift(session); }

      await writeSessions(sessions);
      sendJson(res, 200, { session });
      return;
    }

    if (req.method === "DELETE") {
      const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const id = urlObj.searchParams.get("id");
      if (!id) { sendJson(res, 400, { error: "id required" }); return; }

      const sessions = await readSessions();
      await writeSessions(sessions.filter((s) => s.id !== id));
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "KV_NOT_CONFIGURED") {
      sendJson(res, error.status || 503, {
        error: "Server-side storage is not configured. Set REDIS_URL.",
        code: error.code,
        detail: error.message,
      });
      return;
    }
    sendJson(res, 500, {
      error: "Server error",
      code: error && typeof error === "object" ? error.code || null : null,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
