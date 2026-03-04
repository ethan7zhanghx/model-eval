const MAX_CONFIG_HISTORY = 30;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
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

function normalizeIncomingItems(items) {
  return items.map(normalizeHistoryItem).filter(Boolean).slice(0, MAX_CONFIG_HISTORY);
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

function createError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function getKvConfig() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    throw createError(
      "Vercel KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN.",
      "KV_NOT_CONFIGURED",
      503,
    );
  }

  return { url, token };
}

async function requestKv(command, args = []) {
  const { url, token } = getKvConfig();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command, ...args]),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createError(`KV request failed: HTTP ${response.status}`, "KV_HTTP_ERROR", 502);
  }
  if (payload && payload.error) {
    throw createError(`KV command failed: ${payload.error}`, "KV_COMMAND_ERROR", 502);
  }

  return payload?.result;
}

function historyKey(workspace) {
  return `openrouter-case-runner:config-history:${workspace}`;
}

async function readHistory(workspace) {
  const raw = await requestKv("GET", [historyKey(workspace)]);
  if (typeof raw !== "string" || !raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeIncomingItems(parsed);
  } catch {
    return [];
  }
}

async function writeHistory(workspace, items) {
  const normalized = normalizeIncomingItems(items);
  await requestKv("SET", [historyKey(workspace), JSON.stringify(normalized)]);
  return normalized;
}

module.exports = async function handler(req, res) {
  const workspace = sanitizeWorkspaceId(req.query?.workspace);

  try {
    if (req.method === "GET") {
      const items = await readHistory(workspace);
      sendJson(res, 200, { workspace, items });
      return;
    }

    if (req.method === "PUT") {
      let body;
      try {
        body = parseBody(req);
      } catch (error) {
        sendJson(res, 400, { error: "Invalid JSON body", detail: String(error) });
        return;
      }

      const incomingItems = Array.isArray(body?.items) ? body.items : [];
      const items = await writeHistory(workspace, incomingItems);
      sendJson(res, 200, { workspace, items });
      return;
    }

    if (req.method === "DELETE") {
      const items = await writeHistory(workspace, []);
      sendJson(res, 200, { workspace, items });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "KV_NOT_CONFIGURED") {
      sendJson(res, error.status || 503, {
        error: "Server-side history storage is not configured",
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
