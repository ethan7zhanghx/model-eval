const RECORDS_API_ENDPOINT = "/api/zhumengdao-records";
const SESSIONS_API_ENDPOINT = "/api/zhumengdao-sessions";
const LLM_PROXY_ENDPOINT = "/api/llm-proxy";
const ROLES_DATA_URL = "./roles.json";

const LS_KEY_CONFIG = "zhumengdao-dual-chat-config-v2";
const LS_KEY_SESSION = "zhumengdao-last-session-id";
const MAX_STATS_RECORDS = 1000;

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
    const res = await fetch(`${SESSIONS_API_ENDPOINT}?limit=200`);
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
            <span class="response-latency">${rec.apiA?.latencyMs ? rec.apiA.latencyMs + "ms" : ""}</span>
            ${selectedA ? `<span class="detail-chosen-badge">✓ 已选</span>` : ""}
          </div>
          <div class="detail-response-body">${escapeHtml(rec.apiA?.content || "（无内容）")}</div>
        </div>
        <div class="detail-response ${selectedB ? "detail-selected" : ""} ${!rec.apiB?.ok ? "detail-error" : ""}">
          <div class="detail-response-head">
            <span class="response-tag tag-b">B</span>
            <span class="detail-model">${escapeHtml(rec.apiB?.model || "")}</span>
            <span class="response-latency">${rec.apiB?.latencyMs ? rec.apiB.latencyMs + "ms" : ""}</span>
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
  if (el.latencyA) el.latencyA.textContent = pending.responses[leftSrc].latencyMs ? `${pending.responses[leftSrc].latencyMs}ms` : "";
  if (el.latencyB) el.latencyB.textContent = pending.responses[rightSrc].latencyMs ? `${pending.responses[rightSrc].latencyMs}ms` : "";
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
  if (!config.apiKeyA || !config.apiKeyB) return "请填写 API Key";
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

async function requestOne({ endpoint, apiKey, model, messages, temperature, sourceTag }) {
  const start = performance.now();
  try {
    const response = await fetch(LLM_PROXY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint,
        apiKey,
        payload: { model, messages, temperature, stream: false, enable_thinking: false },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    const latencyMs = Math.round(performance.now() - start);
    if (!response.ok) {
      return { ok: false, sourceTag, latencyMs, content: `请求失败(${response.status})：${payload?.error?.message ?? payload?.error ?? "未知错误"}` };
    }
    return { ok: true, sourceTag, latencyMs, content: normalizeContent(payload?.choices?.[0]?.message?.content) };
  } catch (error) {
    return { ok: false, sourceTag, latencyMs: Math.round(performance.now() - start), content: `网络异常：${error instanceof Error ? error.message : String(error)}` };
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
      content: state.pendingTurn.responses.a.content,
    },
    apiB: {
      endpointHost: parseHost(config.endpointB),
      model: config.modelB,
      ok: state.pendingTurn.responses.b.ok,
      latencyMs: state.pendingTurn.responses.b.latencyMs,
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
    requestOne({ endpoint: config.endpointA, apiKey: config.apiKeyA, model: config.modelA, messages, temperature, sourceTag: "a" }),
    requestOne({ endpoint: config.endpointB, apiKey: config.apiKeyB, model: config.modelB, messages, temperature, sourceTag: "b" }),
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
    if (!cfg.apiKeyA || !cfg.apiKeyB) setSettingsOpen(true);
    if (!restored) setStatus("就绪。", "ok");
  } catch (error) {
    console.error("Init failed:", error);
    state.storageReady = false;
    setBusy(false);
    setStatus("初始化失败，请刷新页面后重试。", "err");
  }
}

void init();
