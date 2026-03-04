const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, "data");
const HISTORY_FILE = path.join(DATA_DIR, "config-history.json");

const MAX_CONFIG_HISTORY = 30;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

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
    systemPrompt: String(item.systemPrompt || "").slice(0, 20000),
    selectedModels,
    rows,
  };
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
      const indexPath = path.join(filePath, "index.html");
      const body = await fs.readFile(indexPath);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
      });
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

  await handleStatic(req, res, urlObj);
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log(`History storage file: ${HISTORY_FILE}`);
});
