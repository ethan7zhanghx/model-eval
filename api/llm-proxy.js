const { Readable } = require("node:stream");

const PROXY_TIMEOUT_MS = 60000;

const ALLOWED_HOSTS = [
  "ark.cn-beijing.volces.com",
  "qianfan.baidubce.com",
  "openrouter.ai",
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
];

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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = parseBody(req);
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

  if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
    sendJson(res, 403, { error: `Host not allowed: ${targetUrl.hostname}` });
    return;
  }

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

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
};
