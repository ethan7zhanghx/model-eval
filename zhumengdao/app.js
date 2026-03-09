const RECORDS_API_ENDPOINT = "/api/zhumengdao-records";
const SESSIONS_API_ENDPOINT = "/api/zhumengdao-sessions";
const LLM_PROXY_ENDPOINT = "/api/llm-proxy";
const ROLES_DATA_URL = "./roles.json";

const LS_KEY_CONFIG = "zhumengdao-dual-chat-config-v2";
const LS_KEY_SESSION = "zhumengdao-last-session-id";
const LS_KEY_DEVICE = "zhumengdao-device-id";
const MAX_STATS_RECORDS = 1000;

function getDeviceId() {
  let id = localStorage.getItem(LS_KEY_DEVICE);
  if (!id) {
    id = "dev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(LS_KEY_DEVICE, id);
  }
  return id;
}

const DEFAULT_CONFIG = {
  endpointA: "https://openrouter.ai/api/v1/chat/completions",
  apiKeyA: "",
  modelA: "openai/gpt-4o-mini",
  endpointB: "https://api.openai.com/v1/chat/completions",
  apiKeyB: "",
  modelB: "gpt-4o-mini",
  selectedRoleId: "",
  temperature: 0,
  rememberKeys: false,
};

const state = {
  roles: [],
  history: [],
  pendingTurn: null,
  busy: false,
  loading: false,
  loadingUserText: "",
  sessionId: "",
  sessionCreatedAt: 0,
  turnOrder: 0,
  storageReady: false,
  serverDefaultKeys: { a: false, b: false },
};

const el = {
  openSettingsBtn: document.getElementById("openSettingsBtn"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  settingsPanel: document.getElementById("settingsPanel"),
  settingsBackdrop: document.getElementById("settingsBackdrop"),
  historyBtn: document.getElementById("historyBtn"),
  closeHistoryBtn: document.getElementById("closeHistoryBtn"),
  historyPanel: document.getElementById("historyPanel"),
  historyBackdrop: document.getElementById("historyBackdrop"),
  historyList: document.getElementById("historyList"),
  sessionModal: document.getElementById("sessionModal"),
  closeSessionModal: document.getElementById("closeSessionModal"),
  sessionModalTitle: document.getElementById("sessionModalTitle"),
  sessionModalMeta: document.getElementById("sessionModalMeta"),
  sessionModalBody: document.getElementById("sessionModalBody"),
  roleSelect: document.getElementById("roleSelect"),
  rolePreview: document.getElementById("rolePreview"),
  temperatureInput: document.getElementById("temperatureInput"),
  rememberKeysInput: document.getElementById("rememberKeysInput"),
  endpointAInput: document.getElementById("endpointAInput"),
  apiKeyAInput: document.getElementById("apiKeyAInput"),
  modelAInput: document.getElementById("modelAInput"),
  endpointBInput: document.getElementById("endpointBInput"),
  apiKeyBInput: document.getElementById("apiKeyBInput"),
  modelBInput: document.getElementById("modelBInput"),
  clearChatBtn: document.getElementById("clearChatBtn"),
  statusBar: document.getElementById("statusBar"),
  chatTimeline: document.getElementById("chatTimeline"),
  comparePanel: document.getElementById("comparePanel"),
  labelLeft: document.getElementById("labelLeft"),
  labelRight: document.getElementById("labelRight"),
  responseA: document.getElementById("responseA"),
  responseB: document.getElementById("responseB"),
  latencyA: document.getElementById("latencyA"),
  latencyB: document.getElementById("latencyB"),
  chooseABtn: document.getElementById("chooseABtn"),
  chooseBBtn: document.getElementById("chooseBBtn"),
  discardTurnBtn: document.getElementById("discardTurnBtn"),
  userInput: document.getElementById("userInput"),
  sendBtn: document.getElementById("sendBtn"),
};

class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.detail = options.detail ?? null;
  }
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function startNewSession() {
  state.sessionId = createId("session");
  state.sessionCreatedAt = Date.now();
  state.turnOrder = 0;
}

function buildSessionPayload() {
  const config = readConfigFromInputs();
  const role = getSelectedRole();
  return {
    id: state.sessionId,
    createdAt: state.sessionCreatedAt || Date.now(),
    updatedAt: Date.now(),
    roleId: role ? role.id : "",
    roleName: role ? role.nickname : "",
    systemPrompt: buildRoleSystemPrompt(role),
    temperature: config.temperature,
    config: {
      modelA: config.modelA,
      modelB: config.modelB,
      endpointHostA: parseHost(config.endpointA),
      endpointHostB: parseHost(config.endpointB),
    },
    turnCount: state.turnOrder,
    deviceId: getDeviceId(),
    messages: state.history.map((m) => ({ role: m.role, content: m.content, source: m.source, time: m.time })),
  };
}

async function persistSession() {
  try {
    const session = buildSessionPayload();
    sessionStorage.setItem(LS_KEY_SESSION, state.sessionId);
    await fetch(SESSIONS_API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session }),
    });
  } catch (e) {
    console.warn("Session persist failed:", e);
  }
}

function restoreSession(session) {
  state.sessionId = session.id;
  state.sessionCreatedAt = session.createdAt || Date.now();
  state.turnOrder = session.turnCount || 0;
  state.pendingTurn = null;
  state.loading = false;
  state.loadingUserText = "";
  state.history = (session.messages || []).map((m) => ({
    role: m.role,
    content: m.content,
    source: m.source,
    time: m.time,
  }));
  sessionStorage.setItem(LS_KEY_SESSION, session.id);
  renderTimeline();
  renderComparePanel();
  setBusy(false);
  setStatus("已恢复对话，可继续输入。", "ok");
}

function clampTemperature(value) {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 2) return 2;
  return value;
}

function shortText(text, max = 340) {
  const raw = String(text || "");
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1)}...`;
}

function normalizeContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return JSON.stringify(part);
      })
      .join("\n");
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    return JSON.stringify(content, null, 2);
  }
  return "(empty response)";
}

function extractContentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return JSON.stringify(part);
      })
      .join("\n");
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    return JSON.stringify(content, null, 2);
  }
  return "";
}

function sanitizeEndpoint(value) { return String(value || "").trim(); }
function sanitizeModel(value) { return String(value || "").trim(); }
function sanitizeKey(value) { return String(value || "").trim(); }

function nowText() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function setStatus(text, type = "normal") {
  el.statusBar.textContent = text;
  el.statusBar.classList.remove("ok", "err", "warn");
  if (["ok", "err", "warn"].includes(type)) el.statusBar.classList.add(type);
}

function setSettingsOpen(open) {
  if (!el.settingsPanel || !el.settingsBackdrop) return;
  el.settingsPanel.setAttribute("aria-hidden", open ? "false" : "true");
  if (open) {
    el.settingsBackdrop.classList.remove("hidden");
  } else {
    el.settingsBackdrop.classList.add("hidden");
  }
}

function setHistoryOpen(open) {
  if (!el.historyPanel || !el.historyBackdrop) return;
  el.historyPanel.setAttribute("aria-hidden", open ? "false" : "true");
  if (open) {
    el.historyBackdrop.classList.remove("hidden");
  } else {
    el.historyBackdrop.classList.add("hidden");
  }
}

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

async function openHistoryPanel() {
  setHistoryOpen(true);
  el.historyList.innerHTML = `<p class="history-empty">加载中...</p>`;
  try {
    const res = await fetch(`${SESSIONS_API_ENDPOINT}?limit=200&deviceId=${encodeURIComponent(getDeviceId())}`);
    const data = await res.json();
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    renderHistoryList(sessions);
  } catch (e) {
    el.historyList.innerHTML = `<p class="history-empty">加载失败</p>`;
  }
}

function renderHistoryList(sessions) {
  if (!sessions.length) {
    el.historyList.innerHTML = `<p class="history-empty">暂无历史记录</p>`;
    return;
  }
  el.historyList.innerHTML = "";
  for (const s of sessions) {
    const item = document.createElement("div");
    item.className = "history-item";
    const firstMsg = s.messages?.find((m) => m.role === "user");
    const preview = firstMsg ? shortText(firstMsg.content, 60) : "（空对话）";
    item.innerHTML = `
      <div class="history-item-title">${escapeHtml(s.roleName || "未知角色")}</div>
      <div class="history-item-meta">
        <span>${formatDate(s.createdAt)}</span>
        <span>${s.turnCount} 轮</span>
        <span>${escapeHtml(s.config?.modelA || "")} vs ${escapeHtml(s.config?.modelB || "")}</span>
      </div>
      <div class="history-item-preview">${escapeHtml(preview)}</div>
    `;
    item.addEventListener("click", () => {
      setHistoryOpen(false);
      restoreSession(s);
    });
    el.historyList.appendChild(item);
  }
}

function escapeHtml(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNonNegativeInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function formatPerfText(meta) {
  if (!meta || typeof meta !== "object") return "";
  const parts = [];
  const latencyMs = toFiniteNumber(meta.latencyMs);
  const ttftMs = toFiniteNumber(meta.ttftMs);
  const tps = toFiniteNumber(meta.tps);
  if (latencyMs != null) parts.push(`${Math.round(latencyMs)}ms`);
  if (ttftMs != null) parts.push(`TTFT ${Math.round(ttftMs)}ms`);
  if (tps != null) parts.push(`TPS ${tps.toFixed(2)}`);
  return parts.join(" · ");
}

async function openSessionDetail(sessionId) {
  el.sessionModal.classList.remove("hidden");
  el.sessionModalBody.innerHTML = `<p style="color:var(--text-soft);text-align:center;padding:32px">加载中...</p>`;

  try {
    // Fetch session + its turn records
    const [sessionRes, recordsRes] = await Promise.all([
      fetch(`${SESSIONS_API_ENDPOINT}?id=${encodeURIComponent(sessionId)}`),
      fetch(`${RECORDS_API_ENDPOINT}?limit=2000`),
    ]);
    const sessionData = await sessionRes.json();
    const recordsData = await recordsRes.json();

    const session = sessionData.session;
    if (!session) { el.sessionModalBody.innerHTML = `<p style="color:var(--err)">加载失败</p>`; return; }

    const allRecords = Array.isArray(recordsData.items) ? recordsData.items : [];
    const turnRecords = allRecords
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => a.turnOrder - b.turnOrder);

    el.sessionModalTitle.textContent = `${session.roleName || "未知角色"} · ${formatDate(session.createdAt)}`;
    el.sessionModalMeta.textContent =
      `模型 A: ${session.config?.modelA || "?"} (${session.config?.endpointHostA || "?"})  ·  ` +
      `模型 B: ${session.config?.modelB || "?"} (${session.config?.endpointHostB || "?"})  ·  ` +
      `Temperature: ${session.temperature ?? 0}  ·  共 ${session.turnCount} 轮`;

    renderSessionDetail(session, turnRecords);
  } catch (e) {
    el.sessionModalBody.innerHTML = `<p style="color:var(--err)">加载失败: ${escapeHtml(String(e))}</p>`;
  }
}

function renderSessionDetail(session, turnRecords) {
  el.sessionModalBody.innerHTML = "";

  // Build a map of turnOrder → record for quick lookup
  const recordByOrder = new Map(turnRecords.map((r) => [r.turnOrder, r]));

  // Reconstruct conversation: interleave user messages with A/B comparison blocks
  // We use turnRecords as the source of truth (they have userText + both responses)
  if (!turnRecords.length) {
    el.sessionModalBody.innerHTML = `<p style="color:var(--text-soft);text-align:center;padding:32px">该对话暂无评测记录</p>`;
    return;
  }

  for (const rec of turnRecords) {
    // User message
    const userEl = document.createElement("article");
    userEl.className = "msg user";
    userEl.innerHTML = `
      <div class="msg-meta"><span>用户</span></div>
      <div class="msg-bubble">${escapeHtml(rec.userText)}</div>
    `;
    el.sessionModalBody.appendChild(userEl);

    // A/B comparison block
    const compEl = document.createElement("div");
    compEl.className = "detail-compare";
    const selectedA = rec.selected === "a";
    const selectedB = rec.selected === "b";
    const discarded = rec.action === "discard";

    compEl.innerHTML = `
      <div class="detail-compare-grid">
        <div class="detail-response ${selectedA ? "detail-selected" : ""} ${!rec.apiA?.ok ? "detail-error" : ""}">
          <div class="detail-response-head">
            <span class="response-tag tag-a">A</span>
            <span class="detail-model">${escapeHtml(rec.apiA?.model || "")}</span>
            <span class="response-latency">${escapeHtml(formatPerfText(rec.apiA))}</span>
            ${selectedA ? `<span class="detail-chosen-badge">✓ 已选</span>` : ""}
          </div>
          <div class="detail-response-body">${escapeHtml(rec.apiA?.content || "（无内容）")}</div>
        </div>
        <div class="detail-response ${selectedB ? "detail-selected" : ""} ${!rec.apiB?.ok ? "detail-error" : ""}">
          <div class="detail-response-head">
            <span class="response-tag tag-b">B</span>
            <span class="detail-model">${escapeHtml(rec.apiB?.model || "")}</span>
            <span class="response-latency">${escapeHtml(formatPerfText(rec.apiB))}</span>
            ${selectedB ? `<span class="detail-chosen-badge">✓ 已选</span>` : ""}
          </div>
          <div class="detail-response-body">${escapeHtml(rec.apiB?.content || "（无内容）")}</div>
        </div>
      </div>
      ${discarded ? `<p class="detail-discard-note">⚠ 本轮已放弃</p>` : ""}
    `;
    el.sessionModalBody.appendChild(compEl);

    // If voted, show the chosen assistant reply in the chat flow
    if (rec.action === "vote" && rec.selected) {
      const chosen = rec.selected === "a" ? rec.apiA : rec.apiB;
      const chosenModel = rec.selectedModel || chosen?.model || rec.selected.toUpperCase();
      const assistantEl = document.createElement("article");
      assistantEl.className = "msg assistant";
      assistantEl.innerHTML = `
        <div class="msg-meta">
          <span>助手</span>
          <span class="msg-source-badge badge-${rec.selected}">${escapeHtml(chosenModel)}</span>
        </div>
        <div class="msg-bubble">${escapeHtml(chosen?.content || "")}</div>
      `;
      el.sessionModalBody.appendChild(assistantEl);
    }
  }
}

function getSelectedRole() {
  const roleId = String(el.roleSelect.value || "");
  return state.roles.find((role) => role.id === roleId) || null;
}

function buildRoleSystemPrompt(role) {
  if (!role) return "";
  return [
    `你正在扮演角色：${role.nickname}`,
    role.identity ? `身份：${role.identity}` : "",
    role.persona ? `人物设定：${role.persona}` : "",
    role.opening ? `开场白参考：${role.opening}` : "",
    "请始终保持角色语气，并与用户持续对话。",
  ].filter(Boolean).join("\n");
}

function renderRolePreview() {
  const role = getSelectedRole();
  if (!role) { el.rolePreview.textContent = "未找到角色设定。"; return; }
  const lines = [
    `昵称：${role.nickname}`,
    role.identity ? `身份：${role.identity}` : "",
    role.persona ? `设定：${shortText(role.persona, 420)}` : "",
    role.opening ? `开场白：${shortText(role.opening, 180)}` : "",
  ].filter(Boolean);
  el.rolePreview.textContent = lines.join("\n");
}

function updateComposerHeight() {
  const input = el.userInput;
  input.style.height = "0";
  const next = Math.max(44, Math.min(160, input.scrollHeight));
  input.style.height = `${next}px`;
}

function readConfigFromInputs() {
  return {
    endpointA: sanitizeEndpoint(el.endpointAInput.value),
    apiKeyA: sanitizeKey(el.apiKeyAInput.value),
    modelA: sanitizeModel(el.modelAInput.value),
    endpointB: sanitizeEndpoint(el.endpointBInput.value),
    apiKeyB: sanitizeKey(el.apiKeyBInput.value),
    modelB: sanitizeModel(el.modelBInput.value),
    selectedRoleId: String(el.roleSelect.value || ""),
    temperature: clampTemperature(Number(el.temperatureInput.value)),
    rememberKeys: !!el.rememberKeysInput.checked,
  };
}

function applyConfigToInputs(config) {
  el.endpointAInput.value = config.endpointA;
  el.apiKeyAInput.value = config.apiKeyA;
  el.modelAInput.value = config.modelA;
  el.endpointBInput.value = config.endpointB;
  el.apiKeyBInput.value = config.apiKeyB;
  el.modelBInput.value = config.modelB;
  el.temperatureInput.value = String(config.temperature);
  el.rememberKeysInput.checked = !!config.rememberKeys;
}

function persistConfig() {
  const config = readConfigFromInputs();
  const payload = {
    ...config,
    apiKeyA: config.rememberKeys ? config.apiKeyA : "",
    apiKeyB: config.rememberKeys ? config.apiKeyB : "",
  };
  localStorage.setItem(LS_KEY_CONFIG, JSON.stringify(payload));
}

function hydrateConfig() {
  let saved = {};
  try {
    const raw = localStorage.getItem(LS_KEY_CONFIG);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") saved = parsed;
    }
  } catch { saved = {}; }

  const config = {
    ...DEFAULT_CONFIG,
    ...saved,
    endpointA: sanitizeEndpoint(saved.endpointA || DEFAULT_CONFIG.endpointA),
    endpointB: sanitizeEndpoint(saved.endpointB || DEFAULT_CONFIG.endpointB),
    modelA: sanitizeModel(saved.modelA || DEFAULT_CONFIG.modelA),
    modelB: sanitizeModel(saved.modelB || DEFAULT_CONFIG.modelB),
    selectedRoleId: String(saved.selectedRoleId || ""),
    apiKeyA: saved.rememberKeys ? sanitizeKey(saved.apiKeyA) : "",
    apiKeyB: saved.rememberKeys ? sanitizeKey(saved.apiKeyB) : "",
    temperature: clampTemperature(Number(saved.temperature)),
    rememberKeys: !!saved.rememberKeys,
  };

  applyConfigToInputs(config);
  if (config.selectedRoleId) el.roleSelect.value = config.selectedRoleId;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function createMessageNode(message) {
  const item = document.createElement("article");
  item.className = `msg ${message.role}`;
  if (message.pending) item.classList.add("pending");

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.innerHTML = `<span>${message.role === "user" ? "你" : "助手"} · ${message.time}</span>`;

  if (message.source) {
    const badge = document.createElement("span");
    badge.className = `msg-source-badge badge-${message.source}`;
    badge.textContent = message.model || message.source.toUpperCase();
    meta.appendChild(badge);
  }

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = message.content;

  item.appendChild(meta);
  item.appendChild(bubble);
  return item;
}

function renderTimeline() {
  el.chatTimeline.innerHTML = "";
  updateSettingsLock();
  const rows = [...state.history];

  if (!rows.length && !state.loading) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.innerHTML = `<span class="chat-empty-icon">⛵</span>从这里开始你的对话`;
    el.chatTimeline.appendChild(empty);
    return;
  }

  for (const row of rows) {
    el.chatTimeline.appendChild(createMessageNode(row));
  }

  if (state.loading) {
    // Show user message being sent
    if (state.loadingUserText) {
      el.chatTimeline.appendChild(createMessageNode({
        role: "user",
        content: state.loadingUserText,
        time: nowText(),
        pending: true,
      }));
    }
    // Typing indicator
    const typing = document.createElement("div");
    typing.className = "typing-indicator";
    typing.innerHTML = `<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>`;
    el.chatTimeline.appendChild(typing);
  } else if (state.pendingTurn) {
    el.chatTimeline.appendChild(createMessageNode({
      role: "user",
      content: state.pendingTurn.userText,
      time: state.pendingTurn.time,
      pending: true,
    }));
  }

  el.chatTimeline.scrollTop = el.chatTimeline.scrollHeight;
}

function renderComparePanel() {
  const pending = state.pendingTurn;
  if (!pending) {
    el.comparePanel.classList.add("hidden");
    el.chatTimeline.style.paddingBottom = "";
    return;
  }

  el.comparePanel.classList.remove("hidden");
  const [leftSrc, rightSrc] = pending.displayOrder;
  el.responseA.textContent = pending.responses[leftSrc].content;
  el.responseB.textContent = pending.responses[rightSrc].content;
  if (el.latencyA) el.latencyA.textContent = formatPerfText(pending.responses[leftSrc]);
  if (el.latencyB) el.latencyB.textContent = formatPerfText(pending.responses[rightSrc]);
  el.chooseABtn.disabled = state.busy || !pending.responses[leftSrc].ok;
  el.chooseBBtn.disabled = state.busy || !pending.responses[rightSrc].ok;
  el.discardTurnBtn.disabled = state.busy;

  requestAnimationFrame(() => {
    const h = el.comparePanel.offsetHeight;
    el.chatTimeline.style.paddingBottom = `${h + 16}px`;
    el.chatTimeline.scrollTop = el.chatTimeline.scrollHeight;
  });
}

function updateSettingsLock() {
  const started = state.history.length > 0 || !!state.pendingTurn;
  el.roleSelect.disabled = started;
  el.temperatureInput.disabled = started;
  if (el.rolePreview) {
    el.rolePreview.style.opacity = started ? "0.5" : "";
  }
}

function setBusy(busy) {
  state.busy = busy;
  const locked = busy || !state.storageReady;
  el.sendBtn.disabled = locked || !!state.pendingTurn;
  el.clearChatBtn.disabled = locked;
  el.userInput.disabled = locked;
  updateSettingsLock();
  renderComparePanel();
}

// ── API helpers ──────────────────────────────────────────────────────────────

function buildRequestMessages(userText) {
  const messages = [];
  const role = getSelectedRole();
  const systemPrompt = buildRoleSystemPrompt(role);
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  for (const item of state.history) {
    messages.push({ role: item.role, content: item.content });
  }
  messages.push({ role: "user", content: userText });
  return messages;
}

function validateConfig(config) {
  const endpointA = sanitizeEndpoint(config.endpointA);
  const endpointB = sanitizeEndpoint(config.endpointB);
  if (!endpointA || !endpointB) return "请完整填写两路 Base URL";
  if (!/^https?:\/\//i.test(endpointA) || !/^https?:\/\//i.test(endpointB)) {
    return "Base URL 必须以 http:// 或 https:// 开头";
  }
  if (!config.apiKeyA || !config.apiKeyB) {
    // 没有用户 key 时，依赖服务端默认 key；如果服务端也没有则报错
    if (!state.serverDefaultKeys?.a && !config.apiKeyA) return "请填写 A 路 API Key（或联系管理员配置默认 Key）";
    if (!state.serverDefaultKeys?.b && !config.apiKeyB) return "请填写 B 路 API Key（或联系管理员配置默认 Key）";
  }
  if (!config.modelA || !config.modelB) return "请完整填写两路 Model ID";
  if (!getSelectedRole()) return "请选择角色设定";
  return null;
}

function parseHost(endpoint) {
  try { return new URL(endpoint).host; }
  catch { return sanitizeEndpoint(endpoint).slice(0, 200); }
}

async function parseJsonSafely(response) {
  try { return await response.json(); }
  catch { return null; }
}

async function requestRecordsApi(url, options) {
  const response = await fetch(url, options);
  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    throw new ApiError(`HTTP ${response.status}`, {
      status: response.status,
      code: payload?.code ?? null,
      detail: payload?.detail ?? payload?.error ?? null,
    });
  }
  return payload ?? {};
}

function buildSummary(items) {
  const sessions = new Set();
  let voteCount = 0, discardCount = 0, aWins = 0, bWins = 0;
  for (const item of items) {
    if (item.sessionId) sessions.add(item.sessionId);
    if (item.action === "vote") {
      voteCount += 1;
      if (item.selected === "a") aWins += 1;
      if (item.selected === "b") bWins += 1;
      continue;
    }
    if (item.action === "discard") discardCount += 1;
  }
  return {
    totalRecords: items.length,
    totalSessions: sessions.size,
    voteCount, discardCount, aWins, bWins,
    aWinRate: voteCount ? Number((aWins / voteCount).toFixed(4)) : 0,
    bWinRate: voteCount ? Number((bWins / voteCount).toFixed(4)) : 0,
  };
}

async function appendRecord(item) {
  const payload = await requestRecordsApi(RECORDS_API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item }),
  });
  if (!payload?.item) throw new ApiError("Record append failed", { code: "RECORD_APPEND_FAILED" });
}

async function fetchRecords(limit = MAX_STATS_RECORDS) {
  const payload = await requestRecordsApi(`${RECORDS_API_ENDPOINT}?limit=${encodeURIComponent(limit)}`, { method: "GET" });
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const summary = payload?.summary && typeof payload.summary === "object" ? payload.summary : buildSummary(items);
  return { items, summary, storage: payload?.storage || "server" };
}

async function refreshStats(options = {}) {
  const { silent = false } = options;
  try {
    await fetchRecords(MAX_STATS_RECORDS);
    state.storageReady = true;
    if (!silent) setStatus("统计已刷新。", "ok");
  } catch (error) {
    state.storageReady = false;
    console.error("Failed to refresh records:", error);
    if (!silent) setStatus("服务不可用，暂时无法发送。", "err");
  }
  setBusy(false);
}

function estimateTokensFromText(text) {
  const raw = String(text || "");
  if (!raw) return 0;
  const cjk = (raw.match(/[\u3400-\u9fff]/g) || []).length;
  const other = raw.length - cjk;
  const estimated = cjk + other / 4;
  return Math.max(1, Math.round(estimated));
}

function splitSseEvents(buffer) {
  const events = [];
  const matcher = /\r?\n\r?\n/g;
  let lastIndex = 0;
  let match;
  while ((match = matcher.exec(buffer)) !== null) {
    events.push(buffer.slice(lastIndex, match.index));
    lastIndex = matcher.lastIndex;
  }
  return { events, rest: buffer.slice(lastIndex) };
}

function getSseEventData(rawEvent) {
  const lines = String(rawEvent || "").split(/\r?\n/);
  const dataLines = [];
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    dataLines.push(line.slice(5).trimStart());
  }
  return dataLines.join("\n").trim();
}

function extractDeltaText(chunk) {
  const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : null;
  if (!choice || typeof choice !== "object") return "";

  const delta = choice.delta && typeof choice.delta === "object" ? choice.delta : null;
  if (typeof delta?.content === "string") return delta.content;
  if (Array.isArray(delta?.content)) {
    return delta.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }

  if (typeof choice.text === "string") return choice.text;

  const message = choice.message && typeof choice.message === "object" ? choice.message : null;
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }

  return "";
}

function extractCompletionTokens(chunk) {
  const candidates = [
    chunk?.usage?.completion_tokens,
    chunk?.completion_tokens,
    chunk?.metrics?.completion_tokens,
  ];
  for (const value of candidates) {
    const parsed = toNonNegativeInt(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function buildFailedResult(sourceTag, latencyMs, content) {
  return {
    ok: false,
    sourceTag,
    latencyMs,
    ttftMs: null,
    tps: null,
    outputTokens: null,
    outputChars: 0,
    tokenSource: "none",
    content,
  };
}

async function requestOne({ endpoint, apiKey, model, messages, temperature, sourceTag, side }) {
  const start = performance.now();
  try {
    const response = await fetch(LLM_PROXY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint,
        apiKey,
        side,
        payload: {
          model,
          messages,
          temperature,
          stream: true,
          stream_options: { include_usage: true },
          enable_thinking: false,
        },
      }),
    });

    const latencyNow = () => Math.round(performance.now() - start);

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      let detail = raw;
      try {
        const parsed = raw ? JSON.parse(raw) : {};
        detail = parsed?.error?.message ?? parsed?.error ?? parsed?.detail ?? raw;
      } catch {
        // keep raw detail
      }
      return buildFailedResult(sourceTag, latencyNow(), `请求失败(${response.status})：${detail || "未知错误"}`);
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();

    // Fallback for providers that ignore stream=true and return a normal JSON payload.
    if (!contentType.includes("text/event-stream") || !response.body) {
      const payload = await response.json().catch(() => ({}));
      const rawContent = extractContentText(payload?.choices?.[0]?.message?.content);
      const content = rawContent || "(empty response)";
      const latencyMs = latencyNow();
      const usageTokens = extractCompletionTokens(payload);
      const outputTokens = usageTokens != null
        ? usageTokens
        : rawContent ? estimateTokensFromText(rawContent) : 0;
      const tokenSource = usageTokens != null ? "usage" : (rawContent ? "estimated" : "none");
      const seconds = Math.max(0.001, latencyMs / 1000);
      return {
        ok: true,
        sourceTag,
        latencyMs,
        ttftMs: null,
        tps: outputTokens > 0 ? Number((outputTokens / seconds).toFixed(2)) : null,
        outputTokens,
        outputChars: rawContent.length,
        tokenSource,
        content,
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let doneSeen = false;
    let content = "";
    let firstTokenAt = null;
    let completionTokens = null;
    let tokenSource = "none";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = splitSseEvents(buffer);
      buffer = rest;

      for (const event of events) {
        const data = getSseEventData(event);
        if (!data) continue;
        if (data === "[DONE]") {
          doneSeen = true;
          break;
        }

        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        const deltaText = extractDeltaText(parsed);
        if (deltaText) {
          if (firstTokenAt == null) firstTokenAt = performance.now();
          content += deltaText;
        }
        const usageTokens = extractCompletionTokens(parsed);
        if (usageTokens != null) {
          completionTokens = usageTokens;
          tokenSource = "usage";
        }
      }

      if (doneSeen) {
        await reader.cancel().catch(() => {});
        break;
      }
    }

    if (buffer.trim()) {
      const lastData = getSseEventData(buffer);
      if (lastData && lastData !== "[DONE]") {
        try {
          const parsed = JSON.parse(lastData);
          const deltaText = extractDeltaText(parsed);
          if (deltaText) {
            if (firstTokenAt == null) firstTokenAt = performance.now();
            content += deltaText;
          }
          const usageTokens = extractCompletionTokens(parsed);
          if (usageTokens != null) {
            completionTokens = usageTokens;
            tokenSource = "usage";
          }
        } catch {
          // ignore trailing fragment
        }
      }
    }

    const rawContent = content;
    content = rawContent || "(empty response)";
    const latencyMs = latencyNow();
    const ttftMs = firstTokenAt == null ? null : Math.round(firstTokenAt - start);
    let outputTokens = completionTokens;
    if (outputTokens == null && rawContent) {
      outputTokens = estimateTokensFromText(rawContent);
      tokenSource = "estimated";
    }
    if (!rawContent) {
      outputTokens = outputTokens ?? 0;
    }

    let tps = null;
    if (outputTokens != null && outputTokens > 0) {
      const generateMs = ttftMs != null ? Math.max(1, latencyMs - ttftMs) : Math.max(1, latencyMs);
      tps = Number((outputTokens / (generateMs / 1000)).toFixed(2));
    }

    return {
      ok: true,
      sourceTag,
      latencyMs,
      ttftMs,
      tps,
      outputTokens,
      outputChars: rawContent.length,
      tokenSource,
      content,
    };
  } catch (error) {
    return buildFailedResult(
      sourceTag,
      Math.round(performance.now() - start),
      `网络异常：${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function buildTurnRecord(action, selected = "") {
  if (!state.pendingTurn) return null;
  const config = readConfigFromInputs();
  const role = getSelectedRole();
  const systemPrompt = buildRoleSystemPrompt(role);
  return {
    id: createId("rec"),
    createdAt: Date.now(),
    action,
    sessionId: state.sessionId,
    turnId: state.pendingTurn.turnId,
    turnOrder: state.pendingTurn.turnOrder,
    selected,
    selectedModel: selected ? (selected === "a" ? config.modelA : config.modelB) : "",
    displayOrder: state.pendingTurn.displayOrder || ["a", "b"],
    roleId: role ? role.id : "",
    roleName: role ? role.nickname : "",
    systemPrompt,
    temperature: config.temperature,
    userText: state.pendingTurn.userText,
    // Full context before this turn (for analysis)
    contextMessages: state.history.map((m) => ({ role: m.role, content: m.content })),
    apiA: {
      endpointHost: parseHost(config.endpointA),
      model: config.modelA,
      ok: state.pendingTurn.responses.a.ok,
      latencyMs: state.pendingTurn.responses.a.latencyMs,
      ttftMs: state.pendingTurn.responses.a.ttftMs,
      tps: state.pendingTurn.responses.a.tps,
      outputTokens: state.pendingTurn.responses.a.outputTokens,
      outputChars: state.pendingTurn.responses.a.outputChars,
      tokenSource: state.pendingTurn.responses.a.tokenSource,
      content: state.pendingTurn.responses.a.content,
    },
    apiB: {
      endpointHost: parseHost(config.endpointB),
      model: config.modelB,
      ok: state.pendingTurn.responses.b.ok,
      latencyMs: state.pendingTurn.responses.b.latencyMs,
      ttftMs: state.pendingTurn.responses.b.ttftMs,
      tps: state.pendingTurn.responses.b.tps,
      outputTokens: state.pendingTurn.responses.b.outputTokens,
      outputChars: state.pendingTurn.responses.b.outputChars,
      tokenSource: state.pendingTurn.responses.b.tokenSource,
      content: state.pendingTurn.responses.b.content,
    },
  };
}

// ── User actions ─────────────────────────────────────────────────────────────

async function sendUserTurn() {
  if (state.busy || !state.storageReady) return;
  if (state.pendingTurn) {
    setStatus("请先从本轮结果中选择一个继续，或跳过本轮", "warn");
    return;
  }

  const userText = String(el.userInput.value || "").trim();
  if (!userText) { setStatus("请输入内容", "warn"); return; }

  const config = readConfigFromInputs();
  const err = validateConfig(config);
  if (err) { setStatus(err, "err"); return; }

  persistConfig();
  const messages = buildRequestMessages(userText);
  const temperature = clampTemperature(Number(config.temperature));
  el.temperatureInput.value = String(temperature);

  // Show user message + typing indicator immediately
  state.loading = true;
  state.loadingUserText = userText;
  el.userInput.value = "";
  updateComposerHeight();
  renderTimeline();

  setBusy(true);
  setStatus("正在生成回答...", "warn");

  const [resultA, resultB] = await Promise.all([
    requestOne({ endpoint: config.endpointA, apiKey: config.apiKeyA, model: config.modelA, messages, temperature, sourceTag: "a", side: "a" }),
    requestOne({ endpoint: config.endpointB, apiKey: config.apiKeyB, model: config.modelB, messages, temperature, sourceTag: "b", side: "b" }),
  ]);

  state.loading = false;
  state.loadingUserText = "";

  state.pendingTurn = {
    turnId: createId("turn"),
    turnOrder: state.turnOrder + 1,
    userText,
    time: nowText(),
    responses: { a: resultA, b: resultB },
    displayOrder: Math.random() < 0.5 ? ["a", "b"] : ["b", "a"],
  };

  setBusy(false);
  renderTimeline();
  renderComparePanel();

  if (!resultA.ok && !resultB.ok) {
    setStatus("两个回答都失败了，请检查配置后重试。", "err");
    return;
  }
  setStatus("回答已返回，请选择更好的一条继续。", "ok");
}

async function chooseTurn(sourceTag) {
  if (!state.pendingTurn || state.busy) return;
  const selected = state.pendingTurn.responses[sourceTag];
  if (!selected || !selected.ok) {
    setStatus("该结果不可用，请选择另一条或跳过本轮。", "warn");
    return;
  }

  const record = buildTurnRecord("vote", sourceTag);
  if (!record) return;

  setBusy(true);
  try {
    await appendRecord(record);
    state.history.push({ role: "user", content: state.pendingTurn.userText, time: state.pendingTurn.time });
    state.history.push({ role: "assistant", content: selected.content, source: sourceTag, model: record.selectedModel, time: nowText() });
    state.turnOrder = state.pendingTurn.turnOrder;
    state.pendingTurn = null;
    renderTimeline();
    renderComparePanel();
    setStatus(`已选择 ${record.selectedModel || sourceTag.toUpperCase()}，已保存。`, "ok");
    await Promise.all([refreshStats({ silent: true }), persistSession()]);
  } catch (error) {
    console.error("Vote append failed:", error);
    setStatus("保存失败，请检查服务后重试。", "err");
    setBusy(false);
  }
}

async function discardTurn() {
  if (!state.pendingTurn || state.busy) return;
  const record = buildTurnRecord("discard", "");
  if (!record) return;

  setBusy(true);
  try {
    await appendRecord(record);
    state.pendingTurn = null;
    renderTimeline();
    renderComparePanel();
    setStatus("已跳过本轮，可继续输入。", "ok");
    await Promise.all([refreshStats({ silent: true }), persistSession()]);
  } catch (error) {
    console.error("Discard append failed:", error);
    setStatus("跳过记录保存失败，请检查服务后重试。", "err");
    setBusy(false);
  }
}

function clearChat() {
  state.history = [];
  state.pendingTurn = null;
  state.loading = false;
  state.loadingUserText = "";
  startNewSession();
  renderTimeline();
  renderComparePanel();
  setBusy(false);
  setStatus("已新建对话。", "ok");
}

// ── Init ─────────────────────────────────────────────────────────────────────

function bindEvents() {
  el.openSettingsBtn.addEventListener("click", () => setSettingsOpen(true));
  el.closeSettingsBtn.addEventListener("click", () => setSettingsOpen(false));
  el.settingsBackdrop.addEventListener("click", () => setSettingsOpen(false));

  el.historyBtn.addEventListener("click", () => { void openHistoryPanel(); });
  el.closeHistoryBtn.addEventListener("click", () => setHistoryOpen(false));
  el.historyBackdrop.addEventListener("click", () => setHistoryOpen(false));
  el.closeSessionModal.addEventListener("click", () => el.sessionModal.classList.add("hidden"));
  el.sessionModal.addEventListener("click", (e) => { if (e.target === el.sessionModal) el.sessionModal.classList.add("hidden"); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setSettingsOpen(false);
      setHistoryOpen(false);
      el.sessionModal.classList.add("hidden");
    }
  });

  el.sendBtn.addEventListener("click", () => void sendUserTurn());
  el.clearChatBtn.addEventListener("click", clearChat);
  el.chooseABtn.addEventListener("click", () => {
    if (!state.pendingTurn) return;
    void chooseTurn(state.pendingTurn.displayOrder[0]);
  });
  el.chooseBBtn.addEventListener("click", () => {
    if (!state.pendingTurn) return;
    void chooseTurn(state.pendingTurn.displayOrder[1]);
  });
  el.discardTurnBtn.addEventListener("click", () => void discardTurn());

  el.userInput.addEventListener("input", updateComposerHeight);
  el.userInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    void sendUserTurn();
  });

  el.roleSelect.addEventListener("change", () => { renderRolePreview(); persistConfig(); });

  const configInputs = [
    el.temperatureInput, el.rememberKeysInput,
    el.endpointAInput, el.apiKeyAInput, el.modelAInput,
    el.endpointBInput, el.apiKeyBInput, el.modelBInput,
  ];
  for (const input of configInputs) {
    const eventName = input === el.rememberKeysInput ? "change" : "blur";
    input.addEventListener(eventName, () => {
      if (input === el.temperatureInput) {
        el.temperatureInput.value = String(clampTemperature(Number(el.temperatureInput.value)));
      }
      persistConfig();
    });
  }

  updateComposerHeight();
}

async function loadRoles() {
  const response = await fetch(ROLES_DATA_URL, { method: "GET" });
  if (!response.ok) throw new Error(`roles.json HTTP ${response.status}`);
  const payload = await response.json();
  const roles = Array.isArray(payload?.roles) ? payload.roles : [];
  state.roles = roles
    .map((item) => ({
      id: String(item?.id || ""),
      nickname: String(item?.nickname || ""),
      identity: String(item?.identity || ""),
      persona: String(item?.persona || ""),
      opening: String(item?.opening || ""),
    }))
    .filter((item) => item.id && item.nickname);

  if (!state.roles.length) throw new Error("roles.json 为空");

  el.roleSelect.innerHTML = "";
  for (const role of state.roles) {
    const option = document.createElement("option");
    option.value = role.id;
    option.textContent = role.identity ? `${role.nickname}｜${role.identity}` : role.nickname;
    el.roleSelect.appendChild(option);
  }
}

async function init() {
  startNewSession();
  setBusy(true);
  setStatus("初始化中...", "warn");

  try {
    await loadRoles();
    hydrateConfig();

    // 拉服务端默认配置，填充用户未填写的 endpoint/model
    try {
      const defRes = await fetch("/api/default-config");
      if (defRes.ok) {
        const def = await defRes.json();
        state.serverDefaultKeys = { a: !!def.a?.hasKey, b: !!def.b?.hasKey };
        if (!el.endpointAInput.value && def.a?.endpoint) el.endpointAInput.value = def.a.endpoint;
        if (!el.modelAInput.value && def.a?.model) el.modelAInput.value = def.a.model;
        if (!el.endpointBInput.value && def.b?.endpoint) el.endpointBInput.value = def.b.endpoint;
        if (!el.modelBInput.value && def.b?.model) el.modelBInput.value = def.b.model;
      }
    } catch { /* 拉不到默认配置不影响正常使用 */ }
    if (!el.roleSelect.value || !getSelectedRole()) el.roleSelect.value = state.roles[0].id;
    renderRolePreview();
    bindEvents();
    renderTimeline();
    renderComparePanel();
    await refreshStats({ silent: true });
    persistConfig();

    // 尝试恢复本标签页上次对话（sessionStorage，不跨标签页）
    const lastSessionId = sessionStorage.getItem(LS_KEY_SESSION);
    let restored = false;
    if (lastSessionId) {
      try {
        const res = await fetch(`${SESSIONS_API_ENDPOINT}?id=${encodeURIComponent(lastSessionId)}`);
        const data = await res.json();
        if (data.session && Array.isArray(data.session.messages) && data.session.messages.length) {
          restoreSession(data.session);
          restored = true;
        }
      } catch (e) {
        console.warn("Failed to restore last session:", e);
      }
    }

    const cfg = readConfigFromInputs();
    // 只有用户没填 key 且服务端也没有默认 key 时才弹出设置面板
    if ((!cfg.apiKeyA && !state.serverDefaultKeys.a) || (!cfg.apiKeyB && !state.serverDefaultKeys.b)) setSettingsOpen(true);
    if (!restored) setStatus("就绪。", "ok");
  } catch (error) {
    console.error("Init failed:", error);
    state.storageReady = false;
    setBusy(false);
    setStatus("初始化失败，请刷新页面后重试。", "err");
  }
}

void init();
