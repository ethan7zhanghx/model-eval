const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");
const { Readable } = require("node:stream");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, "data");
const HISTORY_FILE = path.join(DATA_DIR, "config-history.json");
const ZMD_RECORDS_FILE = path.join(DATA_DIR, "zhumengdao-records.json");
const ZMD_SESSIONS_FILE = path.join(DATA_DIR, "zhumengdao-sessions.json");
const EVAL_RESULTS_FILE = path.join(DATA_DIR, "eval-results.json");
const MAX_EVAL_RESULTS = 200;

const MAX_CONFIG_HISTORY = 30;
const MAX_ZMD_RECORDS = 20000;
const MAX_ZMD_SESSIONS = 5000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const PROXY_TIMEOUT_MS = 60000;

const ALLOWED_PROXY_HOSTS = [
  "ark.cn-beijing.volces.com",
  "qianfan.baidubce.com",
  "openrouter.ai",
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sanitizeWorkspaceId(value) {
  const raw = String(value || "").trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64);
  return cleaned || "default";
}

function clampTemperature(value) {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 2) return 2;
  return value;
}

function clampOutputTokenRatio(value) {
  if (Number.isNaN(value)) return 1;
  if (value < 0.1) return 0.1;
  if (value > 4) return 4;
  return value;
}

function normalizeHistoryItem(item) {
  if (!item || typeof item !== "object") return null;

  const selectedModels = Array.isArray(item.selectedModels)
    ? item.selectedModels.map((model) => String(model || "").trim()).filter(Boolean).slice(0, 20)
    : [];

  const rows = Array.isArray(item.rows)
    ? item.rows
        .map((row) => ({
          prompt: String(row?.prompt ?? "").slice(0, 20000),
        }))
        .slice(0, 200)
    : [];

  const savedAt = Number(item.savedAt);

  return {
    id:
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim().slice(0, 120)
        : `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: String(item.title || "未命名配置").slice(0, 120),
    savedAt: Number.isFinite(savedAt) ? savedAt : Date.now(),
    temperature: clampTemperature(Number(item.temperature)),
    outputTokenRatio: clampOutputTokenRatio(Number(item.outputTokenRatio)),
    systemPrompt: String(item.systemPrompt || "").slice(0, 20000),
    selectedModels,
    rows,
  };
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

function normalizeZmdAction(value) {
  const action = toSafeString(value, 40) || "unknown";
  if (["vote", "discard", "clear", "unknown"].includes(action)) return action;
  return "unknown";
}

function normalizeZmdRecord(item) {
  if (!item || typeof item !== "object") return null;

  const createdAt = toSafeNumber(item.createdAt);
  const apiA = item.apiA && typeof item.apiA === "object" ? item.apiA : {};
  const apiB = item.apiB && typeof item.apiB === "object" ? item.apiB : {};

  return {
    id: toSafeString(item.id, 120) || `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: createdAt || Date.now(),
    action: normalizeZmdAction(item.action),
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

function buildZmdSummary(items) {
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
  return Math.min(2000, Math.floor(parsed));
}

async function ensureHistoryFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(HISTORY_FILE);
  } catch {
    await fs.writeFile(HISTORY_FILE, "{}\n", "utf8");
  }
}

async function readHistoryDb() {
  await ensureHistoryFile();
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

async function writeHistoryDb(db) {
  await ensureHistoryFile();
  const tmpFile = `${HISTORY_FILE}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await fs.rename(tmpFile, HISTORY_FILE);
}

async function ensureZmdRecordsFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(ZMD_RECORDS_FILE);
  } catch {
    await fs.writeFile(ZMD_RECORDS_FILE, "[]\n", "utf8");
  }
}

async function readZmdRecords() {
  await ensureZmdRecordsFile();
  try {
    const raw = await fs.readFile(ZMD_RECORDS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeZmdRecord).filter(Boolean).slice(0, MAX_ZMD_RECORDS);
  } catch {
    return [];
  }
}

async function writeZmdRecords(items) {
  await ensureZmdRecordsFile();
  const normalized = Array.isArray(items) ? items.map(normalizeZmdRecord).filter(Boolean).slice(0, MAX_ZMD_RECORDS) : [];
  const tmpFile = `${ZMD_RECORDS_FILE}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await fs.rename(tmpFile, ZMD_RECORDS_FILE);
}

// ── Sessions storage ──────────────────────────────────────────────────────────

function normalizeZmdSession(item) {
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

async function ensureZmdSessionsFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(ZMD_SESSIONS_FILE); }
  catch { await fs.writeFile(ZMD_SESSIONS_FILE, "[]\n", "utf8"); }
}

async function readZmdSessions() {
  await ensureZmdSessionsFile();
  try {
    const raw = await fs.readFile(ZMD_SESSIONS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeZmdSession).filter(Boolean).slice(0, MAX_ZMD_SESSIONS);
  } catch { return []; }
}

async function writeZmdSessions(items) {
  await ensureZmdSessionsFile();
  const normalized = Array.isArray(items) ? items.map(normalizeZmdSession).filter(Boolean).slice(0, MAX_ZMD_SESSIONS) : [];
  const tmpFile = `${ZMD_SESSIONS_FILE}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await fs.rename(tmpFile, ZMD_SESSIONS_FILE);
}

async function handleZmdSessionsApi(req, res, urlObj) {
  // GET /api/zhumengdao-sessions          → list sessions (newest first, limit param)
  // GET /api/zhumengdao-sessions?id=xxx   → single session
  // POST /api/zhumengdao-sessions         → create session { session }
  // PATCH /api/zhumengdao-sessions        → update session { id, patch }
  // DELETE /api/zhumengdao-sessions?id=xx → delete one session

  if (req.method === "GET") {
    const id = urlObj.searchParams.get("id");
    const sessions = await readZmdSessions();
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
    try { body = await parseJsonBody(req); }
    catch (error) { sendJson(res, 400, { error: "Invalid JSON body", detail: String(error) }); return; }

    const session = normalizeZmdSession(body?.session);
    if (!session) { sendJson(res, 400, { error: "Invalid session" }); return; }

    const sessions = await readZmdSessions();
    // Upsert: replace if same id exists
    const idx = sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) { sessions[idx] = session; }
    else { sessions.unshift(session); }
    await writeZmdSessions(sessions.slice(0, MAX_ZMD_SESSIONS));
    sendJson(res, 200, { session });
    return;
  }

  if (req.method === "PATCH") {
    let body;
    try { body = await parseJsonBody(req); }
    catch (error) { sendJson(res, 400, { error: "Invalid JSON body", detail: String(error) }); return; }

    const { id, patch } = body || {};
    if (!id || !patch) { sendJson(res, 400, { error: "id and patch required" }); return; }

    const sessions = await readZmdSessions();
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx < 0) { sendJson(res, 404, { error: "Session not found" }); return; }

    const updated = normalizeZmdSession({ ...sessions[idx], ...patch, id, updatedAt: Date.now() });
    sessions[idx] = updated;
    await writeZmdSessions(sessions);
    sendJson(res, 200, { session: updated });
    return;
  }

  if (req.method === "DELETE") {
    const id = urlObj.searchParams.get("id");
    if (!id) { sendJson(res, 400, { error: "id required" }); return; }
    const sessions = await readZmdSessions();
    const filtered = sessions.filter((s) => s.id !== id);
    await writeZmdSessions(filtered);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

async function handleLlmProxy(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON body", detail: String(error) });
    return;
  }

  const { endpoint, apiKey, payload: llmPayload } = body || {};

  if (!endpoint || typeof endpoint !== "string") {
    sendJson(res, 400, { error: "Missing endpoint" });
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(endpoint);
  } catch {
    sendJson(res, 400, { error: "Invalid endpoint URL" });
    return;
  }

  if (!ALLOWED_PROXY_HOSTS.includes(targetUrl.hostname)) {
    sendJson(res, 403, { error: `Host not allowed: ${targetUrl.hostname}` });
    return;
  }

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  console.log("[proxy] endpoint:", endpoint);
  console.log("[proxy] apiKey:", apiKey ? apiKey.slice(0, 8) + "..." : "(empty)");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

    const upstream = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(llmPayload),
      signal: controller.signal,
    });

    const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");

    const wantsStream = !!llmPayload?.stream;
    if (wantsStream && upstream.body) {
      res.setHeader("X-Accel-Buffering", "no");
      const upstreamStream = Readable.fromWeb(upstream.body);
      upstreamStream.on("error", () => {
        clearTimeout(timer);
        if (!res.writableEnded) res.end();
      });
      upstreamStream.on("end", () => {
        clearTimeout(timer);
      });
      upstreamStream.on("close", () => {
        clearTimeout(timer);
      });
      upstreamStream.pipe(res);
      return;
    }

    const upstreamBody = await upstream.text();
    clearTimeout(timer);
    res.end(upstreamBody);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    sendJson(res, 502, { error: "Upstream request failed", detail: msg });
  }
}


async function parseJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const size = Buffer.byteLength(chunk);
    total += size;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function handleHistoryApi(req, res, urlObj) {
  const workspace = sanitizeWorkspaceId(urlObj.searchParams.get("workspace"));

  if (req.method === "GET") {
    const db = await readHistoryDb();
    const items = Array.isArray(db[workspace]) ? db[workspace].map(normalizeHistoryItem).filter(Boolean) : [];
    sendJson(res, 200, { workspace, items: items.slice(0, MAX_CONFIG_HISTORY) });
    return;
  }

  if (req.method === "PUT") {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { error: "Invalid JSON body", detail: String(error) });
      return;
    }

    const incomingItems = Array.isArray(body?.items) ? body.items : [];
    const normalized = incomingItems.map(normalizeHistoryItem).filter(Boolean).slice(0, MAX_CONFIG_HISTORY);

    const db = await readHistoryDb();
    db[workspace] = normalized;
    await writeHistoryDb(db);

    sendJson(res, 200, { workspace, items: normalized });
    return;
  }

  if (req.method === "DELETE") {
    const db = await readHistoryDb();
    db[workspace] = [];
    await writeHistoryDb(db);
    sendJson(res, 200, { workspace, items: [] });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

async function handleZmdRecordsApi(req, res, urlObj) {
  if (req.method === "GET") {
    const limit = sanitizeLimit(urlObj.searchParams.get("limit"));
    const records = await readZmdRecords();
    const items = records.slice(0, limit);
    sendJson(res, 200, {
      storage: "local-file",
      items,
      summary: buildZmdSummary(items),
    });
    return;
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { error: "Invalid JSON body", detail: String(error) });
      return;
    }

    const item = normalizeZmdRecord(body?.item);
    if (!item) {
      sendJson(res, 400, { error: "Invalid record item" });
      return;
    }

    const records = await readZmdRecords();
    records.unshift(item);
    await writeZmdRecords(records.slice(0, MAX_ZMD_RECORDS));
    sendJson(res, 200, { storage: "local-file", item });
    return;
  }

  if (req.method === "DELETE") {
    await writeZmdRecords([]);
    sendJson(res, 200, { storage: "local-file", ok: true });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

// ── Eval Results storage ───────────────────────────────────────────────────────

function normalizeEvalResultRow(row) {
  if (!row || typeof row !== "object") return null;
  const results = {};
  if (row.results && typeof row.results === "object") {
    for (const [modelId, r] of Object.entries(row.results)) {
      if (!r || typeof r !== "object") continue;
      const safeId = toSafeString(modelId, 200);
      if (!safeId) continue;
      results[safeId] = {
        ok: !!r.ok,
        skipped: !!r.skipped,
        latencyMs: toSafeNonNegativeNumber(r.latencyMs),
        ttftMs: toSafeNonNegativeNumber(r.ttftMs),
        tps: toSafeNonNegativeNumber(r.tps),
        usage: r.usage && typeof r.usage === "object" ? {
          prompt_tokens: toSafeNonNegativeInt(r.usage.prompt_tokens),
          completion_tokens: toSafeNonNegativeInt(r.usage.completion_tokens),
          total_tokens: toSafeNonNegativeInt(r.usage.total_tokens),
        } : null,
        content: toSafeText(r.content, 50000),
        manualScore: toSafeNonNegativeNumber(r.manualScore),
        ruleScore: toSafeNumber(r.ruleScore),
        judgeScore: toSafeNonNegativeNumber(r.judgeScore),
        judgeDetail: r.judgeDetail && typeof r.judgeDetail === "object" ? {
          accuracy: toSafeNumber(r.judgeDetail.accuracy),
          completeness: toSafeNumber(r.judgeDetail.completeness),
          fluency: toSafeNumber(r.judgeDetail.fluency),
          reason: toSafeString(r.judgeDetail.reason, 500),
        } : null,
      };
    }
  }
  return {
    prompt: toSafeText(row.prompt, 20000),
    scoreRef: toSafeText(row.scoreRef, 5000),
    results,
  };
}

function normalizeEvalResult(item) {
  if (!item || typeof item !== "object") return null;
  const config = item.config && typeof item.config === "object" ? item.config : {};
  const models = Array.isArray(config.models)
    ? config.models.map((m) => toSafeString(m, 200)).filter(Boolean).slice(0, 20)
    : [];
  const rows = Array.isArray(item.rows)
    ? item.rows.map(normalizeEvalResultRow).filter(Boolean).slice(0, 500)
    : [];
  const savedAt = toSafeNumber(item.savedAt);
  return {
    id: toSafeString(item.id, 120) || `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: savedAt || Date.now(),
    config: {
      models,
      systemPrompt: toSafeText(config.systemPrompt, 12000),
      temperature: (() => { const v = toSafeNumber(config.temperature); if (v == null) return 0; return Math.max(0, Math.min(2, v)); })(),
      scoreMethod: toSafeString(config.scoreMethod, 20) || "none",
    },
    rows,
  };
}

async function ensureEvalResultsFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(EVAL_RESULTS_FILE); }
  catch { await fs.writeFile(EVAL_RESULTS_FILE, "[]\n", "utf8"); }
}

async function readEvalResults() {
  await ensureEvalResultsFile();
  try {
    const raw = await fs.readFile(EVAL_RESULTS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEvalResult).filter(Boolean).slice(0, MAX_EVAL_RESULTS);
  } catch { return []; }
}

async function writeEvalResults(items) {
  await ensureEvalResultsFile();
  const normalized = Array.isArray(items) ? items.map(normalizeEvalResult).filter(Boolean).slice(0, MAX_EVAL_RESULTS) : [];
  const tmpFile = `${EVAL_RESULTS_FILE}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await fs.rename(tmpFile, EVAL_RESULTS_FILE);
}

async function handleEvalResultsApi(req, res, urlObj) {
  if (req.method === "GET") {
    const limit = sanitizeLimit(urlObj.searchParams.get("limit") || "100");
    const results = await readEvalResults();
    sendJson(res, 200, { items: results.slice(0, limit), total: results.length });
    return;
  }

  if (req.method === "POST") {
    let body;
    try { body = await parseJsonBody(req); }
    catch (error) { sendJson(res, 400, { error: "Invalid JSON body", detail: String(error) }); return; }
    const item = normalizeEvalResult(body?.item);
    if (!item) { sendJson(res, 400, { error: "Invalid eval result" }); return; }
    const results = await readEvalResults();
    const idx = results.findIndex((r) => r.id === item.id);
    if (idx >= 0) { results[idx] = item; } else { results.unshift(item); }
    await writeEvalResults(results.slice(0, MAX_EVAL_RESULTS));
    sendJson(res, 200, { item });
    return;
  }

  if (req.method === "DELETE") {
    const id = urlObj.searchParams.get("id");
    if (id) {
      const results = await readEvalResults();
      await writeEvalResults(results.filter((r) => r.id !== id));
    } else {
      await writeEvalResults([]);
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

function resolveStaticFile(urlPath) {
  const decoded = decodeURIComponent(urlPath || "/");
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const absPath = path.join(ROOT_DIR, relative);
  const normalized = path.normalize(absPath);
  const relativeToRoot = path.relative(ROOT_DIR, normalized);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return null;
  }
  return normalized;
}

async function handleStatic(req, res, urlObj) {
  const filePath = resolveStaticFile(urlObj.pathname);
  if (!filePath) {
    sendJson(res, 400, { error: "Bad path" });
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      // Redirect /foo to /foo/ so relative asset paths resolve correctly
      if (!urlObj.pathname.endsWith("/")) {
        res.writeHead(301, { Location: urlObj.pathname + "/" });
        res.end();
        return;
      }
      const indexPath = path.join(filePath, "index.html");
      const body = await fs.readFile(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    const body = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": mime });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const urlObj = new URL(req.url || "/", `http://${host}`);

  if (urlObj.pathname === "/api/config-history") {
    try {
      await handleHistoryApi(req, res, urlObj);
    } catch (error) {
      sendJson(res, 500, { error: "Server error", detail: String(error) });
    }
    return;
  }

  if (urlObj.pathname === "/api/default-config") {
    require("./api/default-config")(req, res);
    return;
  }

  if (urlObj.pathname === "/api/llm-proxy") {
    try {
      await handleLlmProxy(req, res);
    } catch (error) {
      sendJson(res, 500, { error: "Server error", detail: String(error) });
    }
    return;
  }

  if (urlObj.pathname === "/api/zhumengdao-records") {
    try {
      await handleZmdRecordsApi(req, res, urlObj);
    } catch (error) {
      sendJson(res, 500, { error: "Server error", detail: String(error) });
    }
    return;
  }

  if (urlObj.pathname === "/api/zhumengdao-sessions") {
    try {
      await handleZmdSessionsApi(req, res, urlObj);
    } catch (error) {
      sendJson(res, 500, { error: "Server error", detail: String(error) });
    }
    return;
  }

  if (urlObj.pathname === "/api/eval-results") {
    try {
      await handleEvalResultsApi(req, res, urlObj);
    } catch (error) {
      sendJson(res, 500, { error: "Server error", detail: String(error) });
    }
    return;
  }

  await handleStatic(req, res, urlObj);
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log(`History storage file: ${HISTORY_FILE}`);
});
