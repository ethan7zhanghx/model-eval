const RECORDS_KEY = "zhumengdao:duel-records:v1";
const MAX_STORED_RECORDS = 20000;
const MAX_READ_LIMIT = 2000;

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
  if (typeof req.body === "object") {
    return req.body;
  }
  return {};
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

function createError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function toSafeString(value, max = 200) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function toSafeText(value, max = 30000) {
  return String(value ?? "").slice(0, max);
}

function toSafeNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toSafeNonNegativeNumber(value) {
  const parsed = toSafeNumber(value);
  if (parsed == null || parsed < 0) return null;
  return parsed;
}

function toSafeNonNegativeInt(value) {
  const parsed = toSafeNonNegativeNumber(value);
  if (parsed == null) return null;
  return Math.round(parsed);
}

function normalizeAction(value) {
  const action = toSafeString(value, 40) || "unknown";
  if (["vote", "discard", "clear", "unknown"].includes(action)) return action;
  return "unknown";
}

function normalizeRecord(item) {
  if (!item || typeof item !== "object") return null;

  const createdAt = toSafeNumber(item.createdAt);
  const apiA = item.apiA && typeof item.apiA === "object" ? item.apiA : {};
  const apiB = item.apiB && typeof item.apiB === "object" ? item.apiB : {};

  return {
    id: toSafeString(item.id, 120) || `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: createdAt || Date.now(),
    action: normalizeAction(item.action),
    sessionId: toSafeString(item.sessionId, 120),
    turnId: toSafeString(item.turnId, 120),
    turnOrder: toSafeNumber(item.turnOrder) || 0,
    selected: ["a", "b", ""].includes(toSafeString(item.selected, 1)) ? toSafeString(item.selected, 1) : "",
    selectedModel: toSafeString(item.selectedModel, 200),
    displayOrder: (() => {
      const order = Array.isArray(item.displayOrder) ? item.displayOrder : [];
      const valid = order.filter((v) => v === "a" || v === "b");
      return valid.length === 2 ? valid : ["a", "b"];
    })(),
    systemPrompt: toSafeText(item.systemPrompt, 12000),
    contextMessages: Array.isArray(item.contextMessages)
      ? item.contextMessages.slice(0, 200).map((m) => ({
          role: ["user", "assistant", "system"].includes(String(m?.role)) ? String(m.role) : "user",
          content: toSafeText(m?.content, 30000),
        }))
      : [],
    temperature: (() => {
      const value = toSafeNumber(item.temperature);
      if (value == null) return null;
      if (value < 0) return 0;
      if (value > 2) return 2;
      return value;
    })(),
    userText: toSafeText(item.userText, 30000),
    apiA: {
      endpointHost: toSafeString(apiA.endpointHost, 200),
      model: toSafeString(apiA.model, 200),
      ok: !!apiA.ok,
      latencyMs: toSafeNumber(apiA.latencyMs),
      ttftMs: toSafeNonNegativeNumber(apiA.ttftMs),
      tps: toSafeNonNegativeNumber(apiA.tps),
      outputTokens: toSafeNonNegativeInt(apiA.outputTokens),
      outputChars: toSafeNonNegativeInt(apiA.outputChars),
      tokenSource: (() => {
        const source = toSafeString(apiA.tokenSource, 20) || "none";
        return ["usage", "estimated", "none"].includes(source) ? source : "none";
      })(),
      content: toSafeText(apiA.content, 50000),
    },
    apiB: {
      endpointHost: toSafeString(apiB.endpointHost, 200),
      model: toSafeString(apiB.model, 200),
      ok: !!apiB.ok,
      latencyMs: toSafeNumber(apiB.latencyMs),
      ttftMs: toSafeNonNegativeNumber(apiB.ttftMs),
      tps: toSafeNonNegativeNumber(apiB.tps),
      outputTokens: toSafeNonNegativeInt(apiB.outputTokens),
      outputChars: toSafeNonNegativeInt(apiB.outputChars),
      tokenSource: (() => {
        const source = toSafeString(apiB.tokenSource, 20) || "none";
        return ["usage", "estimated", "none"].includes(source) ? source : "none";
      })(),
      content: toSafeText(apiB.content, 50000),
    },
  };
}

function buildSummary(items) {
  const sessions = new Set();
  let voteCount = 0;
  let discardCount = 0;
  let aWins = 0;
  let bWins = 0;
  let perfSamples = 0;
  let ttftSamples = 0;
  let tpsSamples = 0;
  let ttftSum = 0;
  let tpsSum = 0;

  for (const item of items) {
    if (item.sessionId) sessions.add(item.sessionId);

    const responses = [item.apiA, item.apiB];
    for (const api of responses) {
      if (!api || !api.ok) continue;
      perfSamples += 1;
      const ttft = toSafeNonNegativeNumber(api.ttftMs);
      if (ttft != null) {
        ttftSum += ttft;
        ttftSamples += 1;
      }
      const tps = toSafeNonNegativeNumber(api.tps);
      if (tps != null) {
        tpsSum += tps;
        tpsSamples += 1;
      }
    }

    if (item.action === "vote") {
      voteCount += 1;
      if (item.selected === "a") aWins += 1;
      if (item.selected === "b") bWins += 1;
      continue;
    }

    if (item.action === "discard") {
      discardCount += 1;
    }
  }

  return {
    totalRecords: items.length,
    totalSessions: sessions.size,
    voteCount,
    discardCount,
    aWins,
    bWins,
    aWinRate: voteCount ? Number((aWins / voteCount).toFixed(4)) : 0,
    bWinRate: voteCount ? Number((bWins / voteCount).toFixed(4)) : 0,
    perfSamples,
    ttftSamples,
    tpsSamples,
    avgTtftMs: ttftSamples ? Number((ttftSum / ttftSamples).toFixed(2)) : null,
    avgTps: tpsSamples ? Number((tpsSum / tpsSamples).toFixed(2)) : null,
  };
}

function sanitizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 300;
  return Math.min(MAX_READ_LIMIT, Math.floor(parsed));
}

async function readRecords(limit) {
  const redis = getRedis();
  const list = await redis.lrange(RECORDS_KEY, 0, limit - 1);
  if (!Array.isArray(list)) return [];

  const items = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    try {
      const parsed = JSON.parse(raw);
      const normalized = normalizeRecord(parsed);
      if (normalized) items.push(normalized);
    } catch {
      // skip invalid record
    }
  }
  return items;
}

async function appendRecord(record) {
  const normalized = normalizeRecord(record);
  if (!normalized) {
    throw createError("Invalid record", "INVALID_RECORD", 400);
  }

  const redis = getRedis();
  await redis.lpush(RECORDS_KEY, JSON.stringify(normalized));
  await redis.ltrim(RECORDS_KEY, 0, MAX_STORED_RECORDS - 1);
  return normalized;
}

async function clearRecords() {
  const redis = getRedis();
  await redis.del(RECORDS_KEY);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const limit = sanitizeLimit(req.query?.limit);
      const items = await readRecords(limit);
      sendJson(res, 200, {
        storage: "vercel-kv",
        items,
        summary: buildSummary(items),
      });
      return;
    }

    if (req.method === "POST") {
      let body;
      try {
        body = parseBody(req);
      } catch (error) {
        sendJson(res, 400, { error: "Invalid JSON body", detail: String(error) });
        return;
      }

      const item = await appendRecord(body?.item);
      sendJson(res, 200, { storage: "vercel-kv", item });
      return;
    }

    if (req.method === "DELETE") {
      await clearRecords();
      sendJson(res, 200, { storage: "vercel-kv", ok: true });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "KV_NOT_CONFIGURED") {
      sendJson(res, error.status || 503, {
        error: "Server-side records storage is not configured",
        code: error.code,
        detail: error.message,
      });
      return;
    }

    if (error && typeof error === "object" && error.code === "INVALID_RECORD") {
      sendJson(res, error.status || 400, {
        error: "Invalid record",
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
