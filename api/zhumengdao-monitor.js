const RECORDS_KEY = "zhumengdao:duel-records:v1";
const ALERT_STATE_KEY = "zhumengdao:monitor:ernie-5.1:v1";
const MAX_RECORDS_TO_SCAN = 20000;

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

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeModel(value) {
  return String(value || "").trim();
}

function isNormalVoteRecord(record) {
  if (!record || typeof record !== "object") return false;
  if (record.action !== "vote") return false;
  if (record.kind === "inspiration" || record.kind === "continue") return false;
  return true;
}

function getWinningModel(record) {
  if (record.selectedModel) return normalizeModel(record.selectedModel);
  if (record.selected === "a") return normalizeModel(record.apiA?.model);
  if (record.selected === "b") return normalizeModel(record.apiB?.model);
  return "";
}

function evaluateModelWinRate(records, options = {}) {
  const targetModel = normalizeModel(options.targetModel || "ernie-5.1");
  const threshold = toFiniteNumber(options.threshold, 0.55);
  const minSamples = Math.max(1, Math.round(toFiniteNumber(options.minSamples, 30)));
  let samples = 0;
  let wins = 0;

  for (const record of records || []) {
    if (!isNormalVoteRecord(record)) continue;
    const modelA = normalizeModel(record.apiA?.model);
    const modelB = normalizeModel(record.apiB?.model);
    if (modelA !== targetModel && modelB !== targetModel) continue;

    samples += 1;
    if (getWinningModel(record) === targetModel) wins += 1;
  }

  const winRate = samples ? Number((wins / samples).toFixed(4)) : 0;
  if (samples < minSamples) {
    return { targetModel, threshold, minSamples, samples, wins, winRate, shouldAlert: false, reason: "INSUFFICIENT_SAMPLES" };
  }
  return {
    targetModel,
    threshold,
    minSamples,
    samples,
    wins,
    winRate,
    shouldAlert: winRate < threshold,
    reason: winRate < threshold ? "BELOW_THRESHOLD" : "OK",
  };
}

async function readRecords(redis) {
  const rows = await redis.lrange(RECORDS_KEY, 0, MAX_RECORDS_TO_SCAN - 1);
  const records = [];
  for (const row of rows || []) {
    if (typeof row !== "string") continue;
    try {
      const parsed = JSON.parse(row);
      if (parsed && typeof parsed === "object") records.push(parsed);
    } catch {
      // Ignore malformed historical rows.
    }
  }
  return records;
}

function parseState(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function shouldSendEmail(state, now = Date.now()) {
  const lastSentAt = toFiniteNumber(state.lastSentAt, 0);
  return !lastSentAt || now - lastSentAt >= 24 * 60 * 60 * 1000;
}

function formatPercent(value) {
  return Math.round(value * 10000) / 100;
}

function formatTime(value = new Date()) {
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function buildAlertEmail({ to, result, now = new Date() }) {
  const pct = formatPercent(result.winRate);
  const thresholdPct = formatPercent(result.threshold);
  return {
    to,
    subject: `[筑梦岛报警] ${result.targetModel} 胜率低于 ${thresholdPct}%`,
    text: [
      `筑梦岛监控发现 ${result.targetModel} 在正常对话 A/B 中的胜率低于阈值。`,
      "",
      `模型：${result.targetModel}`,
      `当前胜率：${pct}%`,
      `报警阈值：${thresholdPct}%`,
      `样本数：${result.samples}`,
      `胜场：${result.wins}`,
      `触发时间：${formatTime(now)}`,
    ].join("\n"),
  };
}

function buildTestEmail({ to, targetModel = "ernie-5.1", now = new Date() }) {
  return {
    to,
    subject: "[筑梦岛监控测试] 邮件链路验证成功",
    text: [
      "这是一封筑梦岛监控测试邮件，用于确认邮件发送链路可用。",
      "",
      `监控项：${targetModel} 正常对话 A/B 胜率`,
      `收件人：${to}`,
      `发送时间：${formatTime(now)}`,
      "",
      "如果你收到这封邮件，说明 Resend API Key、Vercel 环境变量和邮件发送接口均已配置成功。",
    ].join("\n"),
  };
}

async function sendEmail({ to, from, apiKey, subject, text }) {
  if (!apiKey) {
    return { sent: false, skipped: "RESEND_API_KEY is not configured" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || `Resend HTTP ${response.status}`);
    error.status = response.status;
    error.detail = data;
    throw error;
  }
  return { sent: true, provider: "resend", id: data.id || "" };
}

async function sendAlertEmail({ to, from, apiKey, result }) {
  return sendEmail({ from, apiKey, ...buildAlertEmail({ to, result }) });
}

async function sendTestEmail({ to, from, apiKey, targetModel }) {
  return sendEmail({ from, apiKey, ...buildTestEmail({ to, targetModel }) });
}

function isAuthorized(req) {
  const secret = process.env.MONITOR_CRON_SECRET || process.env.CRON_SECRET || "";
  if (!secret) return true;
  const auth = String(req.headers?.authorization || "");
  const querySecret = String(req.query?.secret || "");
  return auth === `Bearer ${secret}` || querySecret === secret;
}

async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  try {
    const redis = getRedis();
    const targetModel = process.env.ALERT_TARGET_MODEL || "ernie-5.1";
    const threshold = toFiniteNumber(process.env.ALERT_WIN_RATE_THRESHOLD, 0.55);
    const minSamples = toFiniteNumber(process.env.ALERT_MIN_SAMPLES, 30);
    const emailTo = process.env.ALERT_EMAIL_TO || "zhanghaoxin@baidu.com";
    const emailFrom = process.env.ALERT_EMAIL_FROM || "Zhumengdao Monitor <onboarding@resend.dev>";

    if (String(req.query?.testEmail || "") === "1") {
      const email = await sendTestEmail({
        to: emailTo,
        from: emailFrom,
        apiKey: process.env.RESEND_API_KEY || "",
        targetModel,
      });
      sendJson(res, 200, {
        ok: true,
        mode: "testEmail",
        email,
        emailTo,
      });
      return;
    }

    const records = await readRecords(redis);
    const result = evaluateModelWinRate(records, { targetModel, threshold, minSamples });
    const state = parseState(await redis.get(ALERT_STATE_KEY));
    let email = { sent: false };

    if (result.shouldAlert && shouldSendEmail(state)) {
      email = await sendAlertEmail({
        to: emailTo,
        from: emailFrom,
        apiKey: process.env.RESEND_API_KEY || "",
        result,
      });
      if (email.sent) {
        await redis.set(ALERT_STATE_KEY, JSON.stringify({
          alerting: true,
          lastSentAt: Date.now(),
          lastWinRate: result.winRate,
          samples: result.samples,
        }));
      }
    } else if (!result.shouldAlert && result.reason === "OK") {
      await redis.del(ALERT_STATE_KEY);
    }

    sendJson(res, 200, {
      ok: true,
      result,
      email,
      emailTo,
      state: {
        alertSuppressed: result.shouldAlert && !shouldSendEmail(state),
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "KV_NOT_CONFIGURED") {
      sendJson(res, error.status || 503, { error: "Redis is not configured", code: error.code, detail: error.message });
      return;
    }
    sendJson(res, error.status || 500, {
      error: "Monitor failed",
      detail: error instanceof Error ? error.message : String(error),
      providerDetail: error?.detail,
    });
  }
}

module.exports = handler;
module.exports.buildAlertEmail = buildAlertEmail;
module.exports.buildTestEmail = buildTestEmail;
module.exports.evaluateModelWinRate = evaluateModelWinRate;
module.exports.shouldSendEmail = shouldSendEmail;
