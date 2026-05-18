const RECORDS_API_ENDPOINT = "/api/zhumengdao-records";
const SESSIONS_API_ENDPOINT = "/api/zhumengdao-sessions";
const LLM_PROXY_ENDPOINT = "/api/llm-proxy";
const ROLES_DATA_URL = "./roles.json";

const LS_KEY_CONFIG = "zhumengdao-dual-chat-config-v2";
const LS_KEY_SESSION = "zhumengdao-last-session-id";
const LS_KEY_DEVICE = "zhumengdao-device-id";
const MAX_STATS_RECORDS = 1000;
const DEFAULT_WORKSPACE_ID = "ws-default";
const DEFAULT_PROJECT_ID = "proj-default";
const DEFAULT_SYSTEM_PROMPT = "你正在一个角色扮演对话 App 中与用户互动。请始终保持角色语气和人设，每次回复只需包含一两轮的动作描写加对话，简练自然，符合即时聊天节奏。动作、表情、神态、心理活动等旁白请放在中文括号（）中。";

function sanitizeEntityId(value, fallback = "") {
  const cleaned = String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 120);
  return cleaned || fallback;
}


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
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  temperature: 0,
  rememberKeys: false,
};

const state = {
  roles: [],
  history: [],
  pendingTurn: null,
  activeInspiration: null,
  selectedInspiration: null,
  inspirationLoading: false,
  activeContinue: null,
  continueLoading: false,
  assistTarget: null,
  busy: false,
  loading: false,
  loadingUserText: "",
  sessionId: "",
  sessionCreatedAt: 0,
  turnOrder: 0,
  workspaceId: DEFAULT_WORKSPACE_ID,
  projectId: DEFAULT_PROJECT_ID,
  experimentId: "",
  linkedRunId: "",
  reportId: "",
  requestedSessionId: "",
  sessionSystemPrompt: "",
  storageReady: false,
  serverDefaultKeys: { a: false, b: false },
  serverDef: { a: {}, b: {} },
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
  systemPromptInput: document.getElementById("systemPromptInput"),
  systemPromptLockHint: document.getElementById("systemPromptLockHint"),
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
  inspirationPanel: document.getElementById("inspirationPanel"),
  chatTimeline: document.getElementById("chatTimeline"),
  compareHeaderLabel: document.getElementById("compareHeaderLabel"),
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
  state.sessionSystemPrompt = "";
}

function hydratePlatformContext() {
  const params = new URLSearchParams(window.location.search);
  state.workspaceId = sanitizeEntityId(params.get("workspaceId"), DEFAULT_WORKSPACE_ID);
  state.projectId = sanitizeEntityId(params.get("projectId"), DEFAULT_PROJECT_ID);
  state.experimentId = sanitizeEntityId(params.get("experimentId"));
  state.linkedRunId = sanitizeEntityId(params.get("linkedRunId") || params.get("runId"));
  state.reportId = sanitizeEntityId(params.get("reportId"));
  state.requestedSessionId = sanitizeEntityId(params.get("sessionId"));
}

function applySessionPlatformContext(session) {
  if (!session || typeof session !== "object") return;
  state.workspaceId = sanitizeEntityId(session.workspaceId, state.workspaceId || DEFAULT_WORKSPACE_ID);
  state.projectId = sanitizeEntityId(session.projectId, state.projectId || DEFAULT_PROJECT_ID);
  state.experimentId = sanitizeEntityId(session.experimentId, state.experimentId);
  state.linkedRunId = sanitizeEntityId(session.linkedRunId || session.runId, state.linkedRunId);
  state.reportId = sanitizeEntityId(session.reportId, state.reportId);
}

function buildScopedApiUrl(baseUrl, extraParams = {}) {
  const url = new URL(baseUrl, window.location.origin);
  url.searchParams.set("workspaceId", state.workspaceId || DEFAULT_WORKSPACE_ID);
  url.searchParams.set("projectId", state.projectId || DEFAULT_PROJECT_ID);
  if (state.experimentId) url.searchParams.set("experimentId", state.experimentId);
  if (state.linkedRunId) url.searchParams.set("linkedRunId", state.linkedRunId);
  if (state.reportId) url.searchParams.set("reportId", state.reportId);
  for (const [key, value] of Object.entries(extraParams)) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

function buildSessionPayload() {
  const config = readConfigFromInputs();
  const role = getSelectedRole();
  const systemPrompt = state.sessionSystemPrompt || buildRoleSystemPrompt(role, config.systemPrompt);
  return {
    id: state.sessionId,
    workspaceId: state.workspaceId,
    projectId: state.projectId,
    experimentId: state.experimentId,
    linkedRunId: state.linkedRunId,
    reportId: state.reportId,
    createdAt: state.sessionCreatedAt || Date.now(),
    updatedAt: Date.now(),
    roleId: role ? role.id : "",
    roleName: role ? role.nickname : "",
    systemPrompt,
    temperature: config.temperature,
    config: {
      modelA: config.modelA,
      modelB: config.modelB,
      endpointHostA: parseHost(config.endpointA),
      endpointHostB: parseHost(config.endpointB),
      systemPrompt: config.systemPrompt,
    },
    turnCount: state.turnOrder,
    deviceId: getDeviceId(),
    messages: state.history.map((m) => {
      if (m.type === "compare") {
        return {
          type: "compare",
          recordId: m.recordId,
          turnId: m.turnId,
          turnOrder: m.turnOrder,
          userText: m.userText,
          responses: m.responses,
          displayOrder: m.displayOrder,
          voted: m.voted,
          votedModel: m.votedModel,
        };
      }
      if (m.type === "inspiration") {
        return {
          type: "inspiration",
          id: m.id,
          afterTurnId: m.afterTurnId,
          options: m.options,
          displayOrder: m.displayOrder,
          selectedOptionId: m.selectedOptionId,
          selectedModel: m.selectedModel,
          used: !!m.used,
          edited: !!m.edited,
          finalUserText: m.finalUserText || "",
        };
      }
      if (m.type === "continue") {
        return {
          type: "continue",
          id: m.id,
          turnId: m.turnId,
          afterTurnId: m.afterTurnId,
          turnOrder: m.turnOrder,
          responses: m.responses,
          displayOrder: m.displayOrder,
          selected: m.selected,
          selectedModel: m.selectedModel,
        };
      }
      return { role: m.role, content: m.content, source: m.source, time: m.time };
    }),
  };
}

async function persistSession() {
  try {
    const session = buildSessionPayload();
    sessionStorage.setItem(LS_KEY_SESSION, state.sessionId);
    await fetch(buildScopedApiUrl(SESSIONS_API_ENDPOINT), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session }),
    });
  } catch (e) {
    console.warn("Session persist failed:", e);
  }
}

function restoreSession(session, options = {}) {
  const { statusText = "已恢复对话，可继续输入。" } = options;

  applySessionPlatformContext(session);
  state.sessionId = session.id;
  state.sessionCreatedAt = session.createdAt || Date.now();
  state.turnOrder = session.turnCount || 0;
  state.pendingTurn = null;
  state.activeInspiration = null;
  state.selectedInspiration = null;
  state.inspirationLoading = false;
  state.activeContinue = null;
  state.continueLoading = false;
  state.assistTarget = null;
  state.sessionSystemPrompt = session.systemPrompt || "";
  state.loading = false;
  state.loadingUserText = "";
  state.history = (session.messages || []).map((m) => {
    if (m.type === "compare") {
      return {
        type: "compare",
        recordId: m.recordId,
        turnId: m.turnId,
        turnOrder: m.turnOrder,
        userText: m.userText,
        responses: m.responses,
        displayOrder: m.displayOrder,
        voted: m.voted,
        votedModel: m.votedModel,
      };
    }
    if (m.type === "inspiration") {
      return {
        type: "inspiration",
        id: m.id,
        afterTurnId: m.afterTurnId,
        options: m.options,
        displayOrder: m.displayOrder,
        selectedOptionId: m.selectedOptionId,
        selectedModel: m.selectedModel,
        used: !!m.used,
        edited: !!m.edited,
        finalUserText: m.finalUserText || "",
      };
    }
    if (m.type === "continue") {
      return {
        type: "continue",
        id: m.id,
        turnId: m.turnId,
        afterTurnId: m.afterTurnId,
        turnOrder: m.turnOrder,
        responses: m.responses,
        displayOrder: m.displayOrder,
        selected: m.selected,
        selectedModel: m.selectedModel,
      };
    }
    if (!m.content) return null;
    return { role: m.role, content: m.content, source: m.source, time: m.time || nowText() };
  }).filter(Boolean);
  const lastInspiration = [...state.history].reverse().find((m) => m.type === "inspiration" && !m.finalUserText);
  state.activeInspiration = lastInspiration || null;
  const lastContinue = [...state.history].reverse().find((m) => m.type === "continue" && !m.selected);
  state.activeContinue = lastContinue || null;
  if (el.systemPromptInput) {
    el.systemPromptInput.value = session.config?.systemPrompt || session.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  }
  sessionStorage.setItem(LS_KEY_SESSION, session.id);
  renderTimeline();
  renderComparePanel();
  renderInspirationPanel();
  setBusy(false);
  setStatus(statusText, "ok");
}

async function restoreRemoteSession(sessionId, options = {}) {
  if (!sessionId) return false;

  try {
    const res = await fetch(buildScopedApiUrl(SESSIONS_API_ENDPOINT, { id: sessionId }));
    const data = await res.json();
    if (!data.session) return false;
    restoreSession(data.session, options);
    return true;
  } catch (error) {
    console.warn(`Failed to restore session ${sessionId}:`, error);
    return false;
  }
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
function sanitizeSystemPrompt(value) {
  const cleaned = String(value || "").trim().slice(0, 12000);
  return cleaned || DEFAULT_SYSTEM_PROMPT;
}

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
    const res = await fetch(buildScopedApiUrl(SESSIONS_API_ENDPOINT, { limit: 200, deviceId: getDeviceId() }));
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
    const firstMsg = s.messages?.find((m) => m.role === "user" && m.type !== "compare" && m.content);
    const preview = firstMsg ? shortText(firstMsg.content, 60) : "（空对话）";
    const scope = [s.projectId, s.experimentId].filter(Boolean).map((value) => shortText(value, 16)).join(" / ");
    item.innerHTML = `
      <div class="history-item-title">${escapeHtml(s.roleName || "未知角色")}</div>
      <div class="history-item-meta">
        <span>${formatDate(s.createdAt)}</span>
        <span>${s.turnCount} 轮</span>
        <span>${escapeHtml(s.config?.modelA || "")} vs ${escapeHtml(s.config?.modelB || "")}</span>
        ${scope ? `<span>${escapeHtml(scope)}</span>` : ""}
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

function normalizeForCompare(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
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
      fetch(buildScopedApiUrl(SESSIONS_API_ENDPOINT, { id: sessionId })),
      fetch(buildScopedApiUrl(RECORDS_API_ENDPOINT, { limit: 2000 })),
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
    const scopeParts = [
      session.projectId ? `Project: ${session.projectId}` : "",
      session.experimentId ? `Experiment: ${session.experimentId}` : "",
      session.linkedRunId ? `Run: ${session.linkedRunId}` : "",
    ].filter(Boolean);
    el.sessionModalMeta.textContent =
      `模型 A: ${session.config?.modelA || "?"} (${session.config?.endpointHostA || "?"})  ·  ` +
      `模型 B: ${session.config?.modelB || "?"} (${session.config?.endpointHostB || "?"})  ·  ` +
      `Temperature: ${session.temperature ?? 0}  ·  共 ${session.turnCount} 轮` +
      (scopeParts.length ? `  ·  ${scopeParts.join("  ·  ")}` : "");

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
    if (rec.action === "inspiration" || rec.kind === "inspiration") {
      const block = document.createElement("div");
      block.className = "timeline-compare inspiration-timeline";
      const order = Array.isArray(rec.displayOrder) && rec.displayOrder.length === 4
        ? rec.displayOrder
        : ["a1", "a2", "b1", "b2"];
      block.innerHTML = `
        <div class="inspiration-head">
          <span>灵感模式</span>
          <span class="inspiration-source">${rec.used ? "已采用" : rec.finalUserText ? "生成后手写" : "未使用"}</span>
        </div>
        <div class="inspiration-grid">
          ${order.map((optionId) => {
            const option = rec.options?.[optionId] || {};
            const chosen = rec.selectedOptionId === optionId;
            return `
              <div class="inspiration-option${chosen ? " selected" : ""}">
                <span>${escapeHtml(option.content || "（空候选）")}</span>
                ${chosen ? `<span class="inspiration-source">${escapeHtml(String(option.source || "").toUpperCase())} · ${escapeHtml(option.model || "未知模型")}</span>` : ""}
              </div>
            `;
          }).join("")}
        </div>
        ${rec.finalUserText ? `<div class="msg-bubble">最终发送：${escapeHtml(rec.finalUserText)}</div>` : ""}
      `;
      el.sessionModalBody.appendChild(block);
      continue;
    }

    if (rec.action === "continue" || rec.kind === "continue") {
      const block = document.createElement("div");
      block.className = "timeline-compare continue-timeline";
      const order = Array.isArray(rec.displayOrder) && rec.displayOrder.length === 2 ? rec.displayOrder : ["a", "b"];
      block.innerHTML = `
        <div class="inspiration-head continue-head">
          <span>继续聊</span>
          <span class="inspiration-source">${rec.selected ? "已加入对话" : "未选择"}</span>
        </div>
        <div class="timeline-compare-grid">
          ${order.map((source) => {
            const response = source === "a" ? rec.apiA : rec.apiB;
            const chosen = rec.selected === source;
            return `
              <article class="tl-response-card${chosen ? " card-chosen" : rec.selected ? " card-unchosen" : ""}">
                <div class="response-card-head">
                  <span class="response-tag tag-${source}">${source.toUpperCase()}</span>
                  <span class="response-latency">${escapeHtml(formatPerfText(response))}</span>
                  ${chosen ? `<span class="tl-chosen-badge">✓ 已选</span>` : ""}
                </div>
                <div class="response-body">${escapeHtml(response?.content || "（无内容）")}</div>
              </article>
            `;
          }).join("")}
        </div>
      `;
      el.sessionModalBody.appendChild(block);
      continue;
    }

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

function buildRoleSystemPrompt(role, configuredPrompt = null) {
  const prompt = sanitizeSystemPrompt(configuredPrompt ?? el.systemPromptInput?.value ?? DEFAULT_SYSTEM_PROMPT);
  if (!role) return "";
  return [
    `你正在扮演角色：${role.nickname}`,
    role.gender ? `性别：${role.gender}` : "",
    role.identity ? `身份：${role.identity}` : "",
    role.persona ? `人物设定：${role.persona}` : "",
    role.opening ? `开场白参考：${role.opening}` : "",
    prompt,
  ].filter(Boolean).join("\n");
}

function renderRolePreview() {
  const role = getSelectedRole();
  if (!role) { el.rolePreview.textContent = "未找到角色设定。"; return; }
  const lines = [
    `昵称：${role.nickname}`,
    role.gender ? `性别：${role.gender}` : "",
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
    systemPrompt: sanitizeSystemPrompt(el.systemPromptInput?.value),
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
  if (el.systemPromptInput) el.systemPromptInput.value = sanitizeSystemPrompt(config.systemPrompt);
  el.temperatureInput.value = String(config.temperature);
  el.rememberKeysInput.checked = !!config.rememberKeys;
}

function persistConfig() {
  const config = readConfigFromInputs();
  const payload = {
    ...config,
    apiKeyA: config.rememberKeys ? config.apiKeyA : "",
    apiKeyB: config.rememberKeys ? config.apiKeyB : "",
    // 记录本次服务端默认值及 hash，下次加载时用来判断管理员是否更新过配置
    _sdHash: state.serverDef?.hash || "",
    _sdEndpointA: state.serverDef?.a?.endpoint || "",
    _sdEndpointB: state.serverDef?.b?.endpoint || "",
    _sdModelA: state.serverDef?.a?.model || "",
    _sdModelB: state.serverDef?.b?.model || "",
  };
  localStorage.setItem(LS_KEY_CONFIG, JSON.stringify(payload));
}

function hydrateConfig(serverDef = { a: {}, b: {} }) {
  let saved = {};
  try {
    const raw = localStorage.getItem(LS_KEY_CONFIG);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") saved = parsed;
    }
  } catch { saved = {}; }

  // 如果服务端配置的 hash 与上次存档不同（或存档里没有 hash），
  // 说明管理员更新了默认配置，endpoint/model 一律跟随服务端新值。
  // 只有 hash 相同时，才保留用户自己主动改过的值。
  const serverHashChanged = !saved._sdHash || saved._sdHash !== serverDef.hash;

  const LEGACY_ENDPOINT_DEFAULTS = [
    "https://openrouter.ai/api/v1/chat/completions",
    "https://api.openai.com/v1/chat/completions",
  ];
  const LEGACY_MODEL_DEFAULTS = ["openai/gpt-4o-mini", "gpt-4o-mini"];
  const LEGACY_SYSTEM_PROMPT_DEFAULTS = [
    "你正在一个角色扮演对话 App 中与用户互动。请始终保持角色语气和人设，每次回复只需包含一两轮的动作描写加对话，简练自然，符合即时聊天节奏。",
  ];
  // 用户主动设置 = hash 没变 且 值非空 且 不是旧硬编码默认 且 不等于上次服务端默认
  const isUserSet = (val, legacyList, prevServerDefault) =>
    !serverHashChanged &&
    !!val &&
    !legacyList.includes(val) &&
    val !== (prevServerDefault || "");

  const userEndpointA = isUserSet(saved.endpointA, LEGACY_ENDPOINT_DEFAULTS, saved._sdEndpointA) ? saved.endpointA : "";
  const userEndpointB = isUserSet(saved.endpointB, LEGACY_ENDPOINT_DEFAULTS, saved._sdEndpointB) ? saved.endpointB : "";
  const userModelA    = isUserSet(saved.modelA,    LEGACY_MODEL_DEFAULTS,    saved._sdModelA)    ? saved.modelA    : "";
  const userModelB    = isUserSet(saved.modelB,    LEGACY_MODEL_DEFAULTS,    saved._sdModelB)    ? saved.modelB    : "";
  const userSystemPrompt = LEGACY_SYSTEM_PROMPT_DEFAULTS.includes(saved.systemPrompt) ? "" : saved.systemPrompt;

  // 优先级：用户 localStorage > 服务端默认 > 代码内置 DEFAULT_CONFIG
  const config = {
    ...DEFAULT_CONFIG,
    ...saved,
    endpointA: sanitizeEndpoint(userEndpointA || serverDef.a?.endpoint || DEFAULT_CONFIG.endpointA),
    endpointB: sanitizeEndpoint(userEndpointB || serverDef.b?.endpoint || DEFAULT_CONFIG.endpointB),
    modelA: sanitizeModel(userModelA || serverDef.a?.model || DEFAULT_CONFIG.modelA),
    modelB: sanitizeModel(userModelB || serverDef.b?.model || DEFAULT_CONFIG.modelB),
    selectedRoleId: String(saved.selectedRoleId || ""),
    systemPrompt: sanitizeSystemPrompt(userSystemPrompt || DEFAULT_CONFIG.systemPrompt),
    apiKeyA: saved.rememberKeys ? sanitizeKey(saved.apiKeyA) : "",
    apiKeyB: saved.rememberKeys ? sanitizeKey(saved.apiKeyB) : "",
    temperature: clampTemperature(Number(saved.temperature)),
    rememberKeys: !!saved.rememberKeys,
  };

  applyConfigToInputs(config);
  if (config.selectedRoleId) el.roleSelect.value = config.selectedRoleId;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function createCompareNode(row) {
  const [leftSrc, rightSrc] = row.displayOrder;
  const leftRes = row.responses[leftSrc];
  const rightRes = row.responses[rightSrc];
  const voted = row.voted; // sourceTag or undefined

  const wrap = document.createElement("div");
  wrap.className = "timeline-compare";

  const grid = document.createElement("div");
  grid.className = "timeline-compare-grid";

  function makeCard(src, res) {
    const card = document.createElement("article");
    card.className = "tl-response-card";
    if (voted) {
      card.classList.add(voted === src ? "card-chosen" : "card-unchosen");
    }

    const head = document.createElement("div");
    head.className = "response-card-head";
    head.innerHTML = `<span class="response-tag tag-${src}">${src.toUpperCase()}</span>` +
      `<span class="response-latency">${escapeHtml(formatPerfText(res))}</span>` +
      (voted === src ? `<span class="tl-chosen-badge">✓ 已选</span>` : "");

    const body = document.createElement("div");
    body.className = "response-body";
    body.textContent = res.content || (res.ok ? "" : `请求失败：${res.error || ""}`);
    if (!res.ok) body.classList.add("response-error");

    card.appendChild(head);
    card.appendChild(body);
    return card;
  }

  grid.appendChild(makeCard(leftSrc, leftRes));
  grid.appendChild(makeCard(rightSrc, rightRes));
  wrap.appendChild(grid);
  return wrap;
}

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

function getInspirationOption(row, optionId) {
  if (!row || !row.options || !optionId) return null;
  return row.options[optionId] || null;
}

function createInspirationNode(row) {
  const item = document.createElement("div");
  item.className = "timeline-compare inspiration-timeline";
  const option = getInspirationOption(row, row.selectedOptionId);
  const sourceText = option ? `${option.source.toUpperCase()} · ${option.model || "未知模型"}` : "未使用";
  item.innerHTML = `
    <div class="inspiration-head">
      <span>灵感模式</span>
      <span class="inspiration-source">${escapeHtml(sourceText)}</span>
    </div>
    <div class="msg-bubble">${escapeHtml(row.finalUserText || option?.content || "已生成候选，用户未采用。")}</div>
  `;
  return item;
}

function createContinueNode(row) {
  const item = document.createElement("div");
  item.className = "timeline-compare continue-timeline";
  const selected = row.selected || "";
  const selectedModel = row.selectedModel || row.responses?.[selected]?.model || selected.toUpperCase();
  const selectedContent = row.responses?.[selected]?.content || "";
  item.innerHTML = `
    <div class="inspiration-head continue-head">
      <span>继续聊</span>
      <span class="inspiration-source">${selected ? `${escapeHtml(selected.toUpperCase())} · ${escapeHtml(selectedModel || "未知模型")}` : "未选择"}</span>
    </div>
    <div class="msg-bubble">${escapeHtml(selectedContent || "已生成候选，尚未选择。")}</div>
  `;
  return item;
}

function renderTimeline() {
  el.chatTimeline.innerHTML = "";
  updateSettingsLock();
  renderInspirationPanel();
  const rows = [...state.history];

  if (!rows.length && !state.loading) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.innerHTML = `<span class="chat-empty-icon">⛵</span>从这里开始你的对话`;
    el.chatTimeline.appendChild(empty);
    return;
  }

  for (const row of rows) {
    if (row.type === "compare") {
      el.chatTimeline.appendChild(createCompareNode(row));
    } else if (row.type === "inspiration") {
      el.chatTimeline.appendChild(createInspirationNode(row));
    } else if (row.type === "continue") {
      el.chatTimeline.appendChild(createContinueNode(row));
    } else {
      el.chatTimeline.appendChild(createMessageNode(row));
    }
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

function renderInspirationPanel() {
  if (!el.inspirationPanel) return;

  if (state.inspirationLoading) {
    el.inspirationPanel.classList.remove("hidden");
    el.inspirationPanel.innerHTML = `
      <div class="inspiration-head">
        <span>正在生成灵感</span>
        <span class="inspiration-source">A/B 各 2 条</span>
      </div>
    `;
    return;
  }

  if (state.continueLoading) {
    el.inspirationPanel.classList.remove("hidden");
    el.inspirationPanel.innerHTML = `
      <div class="inspiration-head continue-head">
        <span>正在生成继续聊</span>
        <span class="inspiration-source">A/B 随机展示</span>
      </div>
    `;
    return;
  }

  const row = state.activeInspiration;
  if (!row || !row.options) {
    const continueRow = state.activeContinue;
    if (continueRow?.responses) {
      const order = Array.isArray(continueRow.displayOrder) && continueRow.displayOrder.length === 2
        ? continueRow.displayOrder
        : ["a", "b"];
      el.inspirationPanel.classList.remove("hidden");
      el.inspirationPanel.innerHTML = `
        <div class="inspiration-head continue-head">
          <span>继续聊候选</span>
          <span class="inspiration-source">选择后直接进入对话</span>
        </div>
        <div class="continue-grid">
          ${order.map((source) => {
            const response = continueRow.responses[source] || {};
            return `
              <button class="continue-option" type="button" data-continue-source="${escapeHtml(source)}" ${response.ok ? "" : "disabled"}>
                <span>${escapeHtml(response.content || "（空候选）")}</span>
              </button>
            `;
          }).join("")}
        </div>
      `;
      for (const button of el.inspirationPanel.querySelectorAll("[data-continue-source]")) {
        button.addEventListener("click", () => chooseContinue(button.getAttribute("data-continue-source")));
      }
      return;
    }

    if (state.assistTarget && !state.pendingTurn && !state.busy && !state.loading) {
      el.inspirationPanel.classList.remove("hidden");
      el.inspirationPanel.innerHTML = `
        <div class="assist-actions">
          <button type="button" class="assist-action-btn" data-assist-action="inspiration">灵感</button>
          <button type="button" class="assist-action-btn continue-action" data-assist-action="continue">继续聊</button>
        </div>
      `;
      el.inspirationPanel.querySelector('[data-assist-action="inspiration"]')
        ?.addEventListener("click", () => generateInspirationForTurn(state.assistTarget.record, state.assistTarget.selectedContent));
      el.inspirationPanel.querySelector('[data-assist-action="continue"]')
        ?.addEventListener("click", () => generateContinueForLatest());
      return;
    }

    el.inspirationPanel.classList.add("hidden");
    el.inspirationPanel.innerHTML = "";
    return;
  }

  const selectedId = state.selectedInspiration?.optionId || row.selectedOptionId || "";
  const order = Array.isArray(row.displayOrder) && row.displayOrder.length === 4
    ? row.displayOrder
    : ["a1", "a2", "b1", "b2"];
  el.inspirationPanel.classList.remove("hidden");
  el.inspirationPanel.innerHTML = `
    <div class="inspiration-head">
      <span>可选回复灵感</span>
      <span class="inspiration-source">${selectedId ? "已选择，再次点击可取消" : "选择后会填入输入框"}</span>
    </div>
    <div class="inspiration-grid">
      ${order.map((optionId) => {
        const option = row.options[optionId] || {};
        const chosen = selectedId === optionId;
        return `
          <button class="inspiration-option${chosen ? " selected" : ""}" type="button" data-option-id="${escapeHtml(optionId)}">
            <span>${escapeHtml(option.content || "（空候选）")}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;

  for (const button of el.inspirationPanel.querySelectorAll("[data-option-id]")) {
    button.addEventListener("click", () => selectInspirationOption(button.getAttribute("data-option-id")));
  }
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
  el.chooseABtn.classList.remove("hidden");
  el.chooseBBtn.classList.remove("hidden");
  el.chooseABtn.disabled = state.busy || !pending.responses[leftSrc].ok;
  el.chooseBBtn.disabled = state.busy || !pending.responses[rightSrc].ok;
  el.discardTurnBtn.disabled = state.busy;
  if (el.compareHeaderLabel) el.compareHeaderLabel.textContent = "选择更好的回答继续对话";

  requestAnimationFrame(() => {
    const h = el.comparePanel.offsetHeight;
    el.chatTimeline.style.paddingBottom = `${h + 16}px`;
    el.chatTimeline.scrollTop = el.chatTimeline.scrollHeight;
  });
}

function updateSettingsLock() {
  const started = state.loading || state.history.length > 0 || !!state.pendingTurn || !!state.sessionSystemPrompt;
  el.roleSelect.disabled = started;
  el.temperatureInput.disabled = started;
  if (el.systemPromptInput) el.systemPromptInput.disabled = started;
  if (el.systemPromptLockHint) {
    el.systemPromptLockHint.textContent = started
      ? "当前会话已锁定 System Prompt；如需调整，请新建对话。"
      : "会话开始后将锁定，确保同一组评测口径一致。";
  }
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
  const systemPrompt = state.sessionSystemPrompt || buildRoleSystemPrompt(role);
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  for (const item of state.history) {
    if (item.type === "compare") {
      // 把选中的那条作为 assistant 消息加入上下文
      if (item.voted) {
        const chosen = item.responses[item.voted];
        if (chosen?.content) messages.push({ role: "assistant", content: chosen.content });
      }
    } else if (item.type === "continue") {
      if (item.selected) {
        const chosen = item.responses?.[item.selected];
        if (chosen?.content) messages.push({ role: "assistant", content: chosen.content });
      }
    } else if (item.type === "inspiration") {
      // 灵感轮次是元数据，不进入角色对话上下文。
      continue;
    } else {
      messages.push({ role: item.role, content: item.content });
    }
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
  const payload = await requestRecordsApi(buildScopedApiUrl(RECORDS_API_ENDPOINT), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item }),
  });
  if (!payload?.item) throw new ApiError("Record append failed", { code: "RECORD_APPEND_FAILED" });
  return payload.item;
}

async function patchRecord(id, patch) {
  const payload = await requestRecordsApi(buildScopedApiUrl(RECORDS_API_ENDPOINT), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, patch }),
  });
  if (!payload?.item) throw new ApiError("Record update failed", { code: "RECORD_UPDATE_FAILED" });
  return payload.item;
}

async function fetchRecords(limit = MAX_STATS_RECORDS) {
  const payload = await requestRecordsApi(buildScopedApiUrl(RECORDS_API_ENDPOINT, { limit }), { method: "GET" });
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
  const systemPrompt = state.sessionSystemPrompt || buildRoleSystemPrompt(role, config.systemPrompt);
  return {
    id: createId("rec"),
    workspaceId: state.workspaceId,
    projectId: state.projectId,
    experimentId: state.experimentId,
    linkedRunId: state.linkedRunId,
    reportId: state.reportId,
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
    contextMessages: state.history
      .filter((m) => m.type !== "compare")
      .map((m) => ({ role: m.role, content: m.content })),
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

function buildInspirationPrompt({ role, roleReply, conversation }) {
  const roleName = role?.nickname || "角色";
  const roleProfile = [
    role?.gender ? `性别：${role.gender}` : "",
    role?.identity ? `身份：${role.identity}` : "",
    role?.persona ? role.persona : "",
    role?.opening ? `开场白：${role.opening}` : "",
  ].filter(Boolean).join("\n");
  const context = conversation
    .map((item) => `${item.role === "assistant" ? roleName : "User"}：${item.content}`)
    .join("\n");

  return [
    `你是User，正在和${roleName}进行互动。`,
    "",
    "【角色卡】",
    `角色名称：${roleName}`,
    roleProfile,
    "",
    "【最近对话】",
    context,
    `${roleName}：${roleReply}`,
    "",
    "【输出内容要求】",
    `现在是在模拟 User 与${roleName}的角色扮演对话。请从 User 视角给出2条可以继续对话的回复候选。`,
    "回复中如有动作、表情、神态、心理活动、感官反应、身体状态等旁白，请放在中文括号（）中。",
    "请只输出可解析 JSON，格式：{\"options\":[\"候选1\",\"候选2\"]}",
  ].filter(Boolean).join("\n");
}

function stripJsonFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeInspirationOptionText(text) {
  return String(text || "").replace(/\s*\n+\s*/g, "").trim();
}

function normalizeParsedOptions(value, depth = 0) {
  if (depth > 2 || value == null) return [];
  if (typeof value === "string") {
    const nested = stripJsonFence(value);
    if (/^\s*[\[{]/.test(nested)) {
      try {
        return normalizeParsedOptions(JSON.parse(nested), depth + 1);
      } catch {
        return [nested];
      }
    }
    return [value];
  }
  const values = Array.isArray(value) ? value : value.options;
  if (!Array.isArray(values)) return [];
  return values
    .flatMap((item) => normalizeParsedOptions(item, depth + 1))
    .map((item) => normalizeInspirationOptionText(item))
    .filter(Boolean)
    .slice(0, 2);
}

function extractOptionsFromJsonLikeText(raw) {
  const match = raw.match(/"options"\s*:\s*\[([\s\S]*?)\]\s*\}?$/);
  if (!match) return [];
  const body = match[1].trim().replace(/^"/, "").replace(/"$/, "");
  return body
    .split(/"\s*,\s*"/)
    .map((item) => item.replace(/\\"/g, '"').replace(/\\\\/g, "\\"))
    .map((item) => normalizeInspirationOptionText(item))
    .filter((item) => item && !/^\{?\s*"options"\s*:/.test(item))
    .slice(0, 2);
}

function parseInspirationOptions(content) {
  const raw = stripJsonFence(content);
  if (!raw) return [];

  const jsonLike = raw.match(/\{[\s\S]*\}/)?.[0] || raw.match(/\[[\s\S]*\]/)?.[0] || "";
  if (jsonLike) {
    try {
      const parsed = JSON.parse(jsonLike);
      const options = normalizeParsedOptions(parsed);
      if (options.length) return options;
    } catch {
      const options = extractOptionsFromJsonLikeText(jsonLike);
      if (options.length) return options;
    }
  }

  if (/^\{?\s*"options"\s*:/.test(raw)) return [];

  return raw
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)]|[一二三四][、.])\s*/, "").trim())
    .map((line) => normalizeInspirationOptionText(line))
    .filter(Boolean)
    .slice(0, 2);
}

function shuffleList(items) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function buildInspirationDisplayOrder() {
  return shuffleList(["a1", "a2", "b1", "b2"]);
}

function buildSelectedConversationWithReply(record, selectedContent) {
  const conversation = Array.isArray(record?.contextMessages)
    ? record.contextMessages.filter((item) => item.role !== "system" && item.content)
    : [];
  if (record?.userText) conversation.push({ role: "user", content: record.userText });
  return { conversation, roleReply: selectedContent || "" };
}

function buildContinuePrompt({ role }) {
  const roleName = role?.nickname || "角色";
  return [
    `现在是在模拟 User 与${roleName}的角色扮演对话。请继续以${roleName}的身份回复下一轮。`,
    "回复中如有动作、表情、神态、心理活动、感官反应、身体状态等旁白，请放在中文括号（）中。",
  ].join("\n");
}

function buildContinueMessages() {
  const messages = buildRequestMessages("");
  messages.pop();
  messages.push({ role: "user", content: buildContinuePrompt({ role: getSelectedRole() }) });
  return messages;
}

function buildInspirationRecord({ record, prompt, resultA, resultB }) {
  const config = readConfigFromInputs();
  const role = getSelectedRole();
  const optionsA = parseInspirationOptions(resultA.content);
  const optionsB = parseInspirationOptions(resultB.content);
  const fallback = (source) => {
    const content = source === "a" ? resultA.content : resultB.content;
    return /^\s*\{?\s*"options"\s*:/.test(String(content || "")) ? "（候选解析失败）我先自己想想怎么回。" : String(content || "").trim();
  };
  const options = {
    a1: { source: "a", model: config.modelA, content: optionsA[0] || fallback("a") || "（暂无候选）" },
    a2: { source: "a", model: config.modelA, content: optionsA[1] || optionsA[0] || fallback("a") || "（暂无候选）" },
    b1: { source: "b", model: config.modelB, content: optionsB[0] || fallback("b") || "（暂无候选）" },
    b2: { source: "b", model: config.modelB, content: optionsB[1] || optionsB[0] || fallback("b") || "（暂无候选）" },
  };

  return {
    id: createId("rec"),
    kind: "inspiration",
    action: "inspiration",
    workspaceId: state.workspaceId,
    projectId: state.projectId,
    experimentId: state.experimentId,
    linkedRunId: state.linkedRunId,
    reportId: state.reportId,
    createdAt: Date.now(),
    sessionId: state.sessionId,
    turnId: createId("insp-turn"),
    inspirationId: createId("insp"),
    afterTurnId: record.turnId,
    turnOrder: record.turnOrder + 0.01,
    selected: "",
    selectedModel: "",
    selectedOptionId: "",
    used: false,
    edited: false,
    finalUserText: "",
    displayOrder: buildInspirationDisplayOrder(),
    roleId: role ? role.id : "",
    roleName: role ? role.nickname : "",
    systemPrompt: prompt,
    temperature: config.temperature,
    userText: record.userText,
    contextMessages: [{ role: "system", content: prompt }],
    options,
    apiA: {
      endpointHost: parseHost(config.endpointA),
      model: config.modelA,
      ok: resultA.ok,
      latencyMs: resultA.latencyMs,
      ttftMs: resultA.ttftMs,
      tps: resultA.tps,
      outputTokens: resultA.outputTokens,
      outputChars: resultA.outputChars,
      tokenSource: resultA.tokenSource,
      content: resultA.content,
    },
    apiB: {
      endpointHost: parseHost(config.endpointB),
      model: config.modelB,
      ok: resultB.ok,
      latencyMs: resultB.latencyMs,
      ttftMs: resultB.ttftMs,
      tps: resultB.tps,
      outputTokens: resultB.outputTokens,
      outputChars: resultB.outputChars,
      tokenSource: resultB.tokenSource,
      content: resultB.content,
    },
  };
}

function buildContinueRecord({ prompt, resultA, resultB }) {
  const config = readConfigFromInputs();
  const role = getSelectedRole();
  const target = state.assistTarget;
  const systemPrompt = state.sessionSystemPrompt || buildRoleSystemPrompt(role, config.systemPrompt);
  return {
    id: createId("rec"),
    kind: "continue",
    action: "continue",
    workspaceId: state.workspaceId,
    projectId: state.projectId,
    experimentId: state.experimentId,
    linkedRunId: state.linkedRunId,
    reportId: state.reportId,
    createdAt: Date.now(),
    sessionId: state.sessionId,
    turnId: createId("continue-turn"),
    afterTurnId: target?.record?.turnId || "",
    turnOrder: state.turnOrder + 1,
    selected: "",
    selectedModel: "",
    displayOrder: Math.random() < 0.5 ? ["a", "b"] : ["b", "a"],
    roleId: role ? role.id : "",
    roleName: role ? role.nickname : "",
    systemPrompt,
    temperature: config.temperature,
    userText: "",
    contextMessages: buildRequestMessages("")
      .slice(0, -1)
      .filter((m) => m.content),
    continuePrompt: prompt,
    apiA: {
      endpointHost: parseHost(config.endpointA),
      model: config.modelA,
      ok: resultA.ok,
      latencyMs: resultA.latencyMs,
      ttftMs: resultA.ttftMs,
      tps: resultA.tps,
      outputTokens: resultA.outputTokens,
      outputChars: resultA.outputChars,
      tokenSource: resultA.tokenSource,
      content: resultA.content,
    },
    apiB: {
      endpointHost: parseHost(config.endpointB),
      model: config.modelB,
      ok: resultB.ok,
      latencyMs: resultB.latencyMs,
      ttftMs: resultB.ttftMs,
      tps: resultB.tps,
      outputTokens: resultB.outputTokens,
      outputChars: resultB.outputChars,
      tokenSource: resultB.tokenSource,
      content: resultB.content,
    },
  };
}

function syncInspirationHistory(updated) {
  const idx = state.history.findIndex((item) => item.type === "inspiration" && item.id === updated.id);
  const historyRow = {
    type: "inspiration",
    id: updated.id,
    afterTurnId: updated.afterTurnId,
    options: updated.options,
    displayOrder: updated.displayOrder,
    selectedOptionId: updated.selectedOptionId,
    selectedModel: updated.selectedModel,
    used: !!updated.used,
    edited: !!updated.edited,
    finalUserText: updated.finalUserText || "",
  };
  if (idx >= 0) state.history[idx] = historyRow;
  else state.history.push(historyRow);
}

function syncContinueHistory(updated) {
  const idx = state.history.findIndex((item) => item.type === "continue" && item.id === updated.id);
  const responses = updated.responses || { a: updated.apiA, b: updated.apiB };
  const historyRow = {
    type: "continue",
    id: updated.id,
    turnId: updated.turnId,
    afterTurnId: updated.afterTurnId,
    turnOrder: updated.turnOrder,
    responses,
    displayOrder: updated.displayOrder,
    selected: updated.selected,
    selectedModel: updated.selectedModel,
  };
  if (idx >= 0) state.history[idx] = historyRow;
  else state.history.push(historyRow);
}

function selectInspirationOption(optionId) {
  const row = state.activeInspiration;
  const option = getInspirationOption(row, optionId);
  if (!row || !option) return;
  if (state.selectedInspiration?.optionId === optionId) {
    state.selectedInspiration = null;
    renderInspirationPanel();
    el.userInput.focus();
    return;
  }
  state.selectedInspiration = { optionId, source: option.source, model: option.model, originalText: option.content };
  el.userInput.value = option.content;
  updateComposerHeight();
  renderInspirationPanel();
  el.userInput.focus();
}

async function generateInspirationForTurn(record, selectedContent) {
  if (!record || state.busy || state.inspirationLoading || state.continueLoading) return;
  const config = readConfigFromInputs();
  const { conversation, roleReply } = buildSelectedConversationWithReply(record, selectedContent);
  const prompt = buildInspirationPrompt({ role: getSelectedRole(), roleReply, conversation });
  const messages = [{ role: "user", content: prompt }];

  state.inspirationLoading = true;
  renderInspirationPanel();
  setStatus("正在生成回复灵感...", "warn");

  try {
    const [resultA, resultB] = await Promise.all([
      requestOne({ endpoint: config.endpointA, apiKey: config.apiKeyA, model: config.modelA, messages, temperature: config.temperature, sourceTag: "a", side: "a" }),
      requestOne({ endpoint: config.endpointB, apiKey: config.apiKeyB, model: config.modelB, messages, temperature: config.temperature, sourceTag: "b", side: "b" }),
    ]);

    const inspiration = buildInspirationRecord({ record, prompt, resultA, resultB });
    const saved = await appendRecord(inspiration);
    state.activeInspiration = saved;
    state.selectedInspiration = null;
    syncInspirationHistory(saved);
    await Promise.all([refreshStats({ silent: true }), persistSession()]);
    setStatus("灵感已生成，可选择一条填入输入框。", "ok");
  } finally {
    state.inspirationLoading = false;
    renderInspirationPanel();
    renderTimeline();
  }
}

async function generateContinueForLatest() {
  if (!state.assistTarget || state.busy || state.inspirationLoading || state.continueLoading) return;
  const config = readConfigFromInputs();
  const err = validateConfig(config);
  if (err) { setStatus(err, "err"); return; }

  const prompt = buildContinuePrompt({ role: getSelectedRole() });
  const messages = buildContinueMessages();
  const temperature = clampTemperature(Number(config.temperature));

  state.activeInspiration = null;
  state.selectedInspiration = null;
  state.activeContinue = null;
  state.continueLoading = true;
  renderInspirationPanel();
  setBusy(true);
  setStatus("正在生成继续聊候选...", "warn");

  try {
    const [resultA, resultB] = await Promise.all([
      requestOne({ endpoint: config.endpointA, apiKey: config.apiKeyA, model: config.modelA, messages, temperature, sourceTag: "a", side: "a" }),
      requestOne({ endpoint: config.endpointB, apiKey: config.apiKeyB, model: config.modelB, messages, temperature, sourceTag: "b", side: "b" }),
    ]);

    const record = buildContinueRecord({ prompt, resultA, resultB });
    const saved = await appendRecord(record);
    state.activeContinue = {
      type: "continue",
      id: saved.id,
      turnId: saved.turnId,
      afterTurnId: saved.afterTurnId,
      turnOrder: saved.turnOrder,
      responses: { a: saved.apiA, b: saved.apiB },
      displayOrder: saved.displayOrder,
      selected: "",
      selectedModel: "",
    };
    await refreshStats({ silent: true });
    setStatus("继续聊已生成，请选择更好的一条。", "ok");
  } catch (error) {
    console.error("Continue generation failed:", error);
    setStatus("继续聊生成失败，请稍后重试。", "err");
  } finally {
    state.continueLoading = false;
    setBusy(false);
    renderInspirationPanel();
    renderTimeline();
  }
}

async function chooseContinue(sourceTag) {
  const row = state.activeContinue;
  const selected = row?.responses?.[sourceTag];
  if (!row?.id || !selected || !selected.ok || state.busy) return;

  const patch = {
    selected: sourceTag,
    selectedModel: selected.model || "",
  };
  const optimistic = { ...row, ...patch };
  syncContinueHistory(optimistic);
  state.activeContinue = null;
  state.assistTarget = {
    record: {
      turnId: row.turnId,
      turnOrder: row.turnOrder,
      contextMessages: buildRequestMessages("").slice(0, -1),
      userText: "",
    },
    selectedContent: selected.content || "",
  };
  state.turnOrder = Math.max(state.turnOrder, Number(row.turnOrder) || state.turnOrder);
  renderInspirationPanel();
  renderTimeline();
  setBusy(true);

  try {
    const updated = await patchRecord(row.id, patch);
    syncContinueHistory(updated);
    state.assistTarget = { record: updated, selectedContent: selected.content || "" };
    await Promise.all([refreshStats({ silent: true }), persistSession()]);
    setStatus(`已选择 ${patch.selectedModel || sourceTag.toUpperCase()}，继续聊已加入对话。`, "ok");
  } catch (error) {
    console.error("Continue selection failed:", error);
    setStatus("继续聊记录保存失败，请稍后重试。", "err");
  } finally {
    setBusy(false);
    renderTimeline();
    renderInspirationPanel();
  }
}

async function updateInspirationUsage(userText) {
  const row = state.activeInspiration;
  if (!row?.id) return;

  const selected = state.selectedInspiration;
  const patch = selected
    ? {
        used: true,
        selectedOptionId: selected.optionId,
        selected: selected.source,
        selectedModel: selected.model,
        finalUserText: userText,
        edited: normalizeForCompare(userText) !== normalizeForCompare(selected.originalText),
      }
    : {
        used: false,
        selectedOptionId: "",
        selected: "",
        selectedModel: "",
        finalUserText: userText,
        edited: false,
      };

  const optimistic = { ...row, ...patch };
  syncInspirationHistory(optimistic);
  state.activeInspiration = null;
  state.selectedInspiration = null;
  renderInspirationPanel();
  renderTimeline();

  const updated = await patchRecord(row.id, patch);
  syncInspirationHistory(updated);
  renderTimeline();
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
  if (!state.sessionSystemPrompt) {
    state.sessionSystemPrompt = buildRoleSystemPrompt(getSelectedRole(), config.systemPrompt);
  }
  state.assistTarget = null;
  state.activeContinue = null;
  void updateInspirationUsage(userText).catch((error) => {
    console.error("Inspiration update failed:", error);
  });
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
  const selectedContent = selected.content || "";

  setBusy(true);
  try {
    await appendRecord(record);
    // 把用户消息 + 对比结果（带 voted 标记）写入 history
    state.history.push({ role: "user", content: state.pendingTurn.userText, time: state.pendingTurn.time });
    state.history.push({
      type: "compare",
      recordId: record.id,
      turnId: record.turnId,
      turnOrder: record.turnOrder,
      userText: state.pendingTurn.userText,
      responses: state.pendingTurn.responses,
      displayOrder: state.pendingTurn.displayOrder,
      voted: sourceTag,
      votedModel: record.selectedModel,
    });
    state.turnOrder = state.pendingTurn.turnOrder;
    state.assistTarget = { record, selectedContent };
    state.pendingTurn = null;
    setBusy(false);
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
    state.assistTarget = null;
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
  state.activeInspiration = null;
  state.selectedInspiration = null;
  state.inspirationLoading = false;
  state.activeContinue = null;
  state.continueLoading = false;
  state.assistTarget = null;
  state.loading = false;
  state.loadingUserText = "";
  startNewSession();
  renderTimeline();
  renderComparePanel();
  renderInspirationPanel();
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
    el.temperatureInput, el.systemPromptInput, el.rememberKeysInput,
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
      gender: String(item?.gender || ""),
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
  hydratePlatformContext();
  startNewSession();
  setBusy(true);
  setStatus("初始化中...", "warn");

  try {
    await loadRoles();

    // 先拉服务端默认配置，再 hydrate（服务端默认值优先于 DEFAULT_CONFIG，但低于用户 localStorage）
    let serverDef = { a: {}, b: {} };
    try {
      const defRes = await fetch("/api/default-config");
      if (defRes.ok) {
        const def = await defRes.json();
        serverDef = def;
        state.serverDef = def;
        state.serverDefaultKeys = { a: !!def.a?.hasKey, b: !!def.b?.hasKey };
      }
    } catch { /* 拉不到默认配置不影响正常使用 */ }

    hydrateConfig(serverDef);
    if (!el.roleSelect.value || !getSelectedRole()) el.roleSelect.value = state.roles[0].id;
    renderRolePreview();
    bindEvents();
    renderTimeline();
    renderComparePanel();
    renderInspirationPanel();
    await refreshStats({ silent: true });
    persistConfig();

    // 优先恢复主平台带过来的 sessionId，其次再恢复本标签页上次对话。
    const lastSessionId = sessionStorage.getItem(LS_KEY_SESSION);
    let restored = false;

    if (state.requestedSessionId) {
      restored = await restoreRemoteSession(state.requestedSessionId, { statusText: "已恢复主平台关联会话，可继续输入。" });
    }

    if (!restored && lastSessionId && lastSessionId !== state.requestedSessionId) {
      restored = await restoreRemoteSession(lastSessionId, { statusText: "已恢复上次对话，可继续输入。" });
    }

    const cfg = readConfigFromInputs();
    // 只有用户没填 key 且服务端也没有默认 key 时才弹出设置面板
    if ((!cfg.apiKeyA && !state.serverDefaultKeys.a) || (!cfg.apiKeyB && !state.serverDefaultKeys.b)) setSettingsOpen(true);
    if (!restored) setStatus(`就绪。当前 Project: ${state.projectId}${state.experimentId ? ` · Experiment: ${state.experimentId}` : ""}`, "ok");
  } catch (error) {
    console.error("Init failed:", error);
    state.storageReady = false;
    setBusy(false);
    setStatus("初始化失败，请刷新页面后重试。", "err");
  }
}

void init();
