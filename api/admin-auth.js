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

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    sendJson(res, 503, { error: "Admin password not configured" });
    return;
  }

  let body;
  try { body = parseBody(req); }
  catch { sendJson(res, 400, { error: "Invalid JSON body" }); return; }

  if (body.password !== adminPassword) {
    sendJson(res, 401, { error: "密码错误" });
    return;
  }

  sendJson(res, 200, { ok: true });
};
