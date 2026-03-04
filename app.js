const OPENROUTER_CHAT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";
const HISTORY_API_ENDPOINT = "/api/config-history";

const LS_KEY_API = "or-comparator-api-key";
const LS_KEY_WORKSPACE = "or-comparator-workspace-id";
const LS_KEY_MODELS_CACHE = "or-comparator-models-cache-v1";
const LS_KEY_HISTORY_BACKUP = "or-comparator-history-backup-v1";
const LS_KEY_HISTORY_LEGACY = "or-comparator-config-history-v1";

const MODEL_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_CONFIG_HISTORY = 30;

const FALLBACK_MODELS = [
  "openai/gpt-4o-mini",
  "anthropic/claude-3.5-sonnet",
  "google/gemini-2.0-flash-001",
];

const state = {
  availableModels: [],
  selectedModels: ["", ""],
  rows: [],
  running: false,
  modelSyncedAt: null,
  configHistory: [],
};

const el = {
  apiKeyInput: document.getElementById("apiKeyInput"),
  temperatureInput: document.getElementById("temperatureInput"),
  workspaceInput: document.getElementById("workspaceInput"),
  rememberKeyInput: document.getElementById("rememberKeyInput"),
  systemPromptInput: document.getElementById("systemPromptInput"),
  outputTokenRatioInput: document.getElementById("outputTokenRatioInput"),
  runWorkflowBtn: document.getElementById("runWorkflowBtn"),
  clearResultsBtn: document.getElementById("clearResultsBtn"),
  exportBtn: document.getElementById("exportBtn"),
  costSummary: document.getElementById("costSummary"),
  statusBar: document.getElementById("statusBar"),
  refreshModelsBtn: document.getElementById("refreshModelsBtn"),
  addModelColBtn: document.getElementById("addModelColBtn"),
  modelMeta: document.getElementById("modelMeta"),
  modelColumns: document.getElementById("modelColumns"),
  modelColumnTemplate: document.getElementById("modelColumnTemplate"),
  saveConfigBtn: document.getElementById("saveConfigBtn"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  historyList: document.getElementById("historyList"),
  historyItemTemplate: document.getElementById("historyItemTemplate"),
  importPromptBtn: document.getElementById("importPromptBtn"),
  promptFileInput: document.getElementById("promptFileInput"),
  addRowBtn: document.getElementById("addRowBtn"),
  clearRowsBtn: document.getElementById("clearRowsBtn"),
  caseTableHead: document.getElementById("caseTableHead"),
  caseTableBody: document.getElementById("caseTableBody"),
};

let rowIdSeed = 1;
let historySyncQueue = Promise.resolve();

function createRow(prompt = "") {
  return {
    id: rowIdSeed++,
    prompt,
    results: {},
  };
}

function createSnapshotId() {
  return `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function shortText(text, max = 36) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function clampTemperature(value) {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 2) return 2;
  return value;
}

function sanitizeWorkspaceId(value) {
  const raw = String(value || "").trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64);
  return cleaned || "default";
}

function getWorkspaceId() {
  const normalized = sanitizeWorkspaceId(el.workspaceInput.value);
  if (el.workspaceInput.value !== normalized) {
    el.workspaceInput.value = normalized;
  }
  return normalized;
}

function setStatus(text, type = "normal") {
  el.statusBar.textContent = text;
  el.statusBar.classList.remove("ok", "err", "warn");
  if (["ok", "err", "warn"].includes(type)) {
    el.statusBar.classList.add(type);
  }
}

function setModelMeta(text, type = "normal") {
  el.modelMeta.textContent = text;
  el.modelMeta.classList.remove("ok", "err");
  if (type === "ok" || type === "err") {
    el.modelMeta.classList.add(type);
  }
}

function normalizeContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") {
          return part.text;
        }
        return JSON.stringify(part);
      })
      .join("\n");
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") {
      return content.text;
    }
    return JSON.stringify(content, null, 2);
  }
  return "(empty response)";
}

function isSupportedPromptFile(filename) {
  const lower = String(filename || "").toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".txt");
}

function splitByMarkdownRules(text) {
  return text
    .split(/\n\s*---+\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function splitByMarkdownHeadings(text) {
  const lines = text.split("\n");
  const sections = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch) {
      if (current) {
        sections.push(current);
      }
      current = {
        title: headingMatch[1].trim(),
        body: "",
      };
      continue;
    }

    if (!current) {
      current = { title: "", body: "" };
    }
    current.body = current.body ? `${current.body}\n${rawLine}` : rawLine;
  }

  if (current) {
    sections.push(current);
  }

  return sections
    .map((section) => {
      const body = section.body.trim();
      if (body) return body;
      return section.title.trim();
    })
    .filter(Boolean);
}

function parsePromptTextToRows(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const byRules = splitByMarkdownRules(normalized);
  if (byRules.length > 1) return byRules;

  const byHeadings = splitByMarkdownHeadings(normalized);
  if (byHeadings.length > 1) return byHeadings;

  const byBlankLines = normalized
    .split(/\n{2,}/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (byBlankLines.length > 1) return byBlankLines;

  const byNonEmptyLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (byNonEmptyLines.length > 1) return byNonEmptyLines;

  return [normalized];
}

function formatSyncTime(ts) {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function getSelectedModels() {
  return state.selectedModels.map((m) => m.trim()).filter(Boolean);
}

function hasDuplicateModels(models) {
  const cleaned = models.map((m) => m.trim()).filter(Boolean);
  return new Set(cleaned).size !== cleaned.length;
}

function parseTemperature() {
  return clampTemperature(Number(el.temperatureInput.value));
}

function parseOutputTokenRatio() {
  const raw = Number(el.outputTokenRatioInput.value);
  if (Number.isNaN(raw)) return 1;
  if (raw < 0.1) return 0.1;
  if (raw > 4) return 4;
  return raw;
}

function parsePricePerToken(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function formatUsd(value, digits = 6) {
  if (!Number.isFinite(value)) return "N/A";
  return `$${value.toFixed(digits)}`;
}

function formatPricePerMillion(perToken) {
  if (!Number.isFinite(perToken)) return "N/A";
  return `${formatUsd(perToken * 1_000_000, 4)}/M`;
}

function saveApiKeyPreference() {
  const apiKey = el.apiKeyInput.value.trim();
  if (el.rememberKeyInput.checked && apiKey) {
    localStorage.setItem(LS_KEY_API, apiKey);
    return;
  }
  localStorage.removeItem(LS_KEY_API);
}

function hydrateApiKeyPreference() {
  const saved = localStorage.getItem(LS_KEY_API);
  if (!saved) return;
  el.apiKeyInput.value = saved;
  el.rememberKeyInput.checked = true;
}

function saveWorkspacePreference() {
  localStorage.setItem(LS_KEY_WORKSPACE, getWorkspaceId());
}

function hydrateWorkspacePreference() {
  const saved = localStorage.getItem(LS_KEY_WORKSPACE);
  if (!saved) return;
  el.workspaceInput.value = sanitizeWorkspaceId(saved);
}

function getModelCache() {
  try {
    const raw = localStorage.getItem(LS_KEY_MODELS_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.models) || !parsed.syncedAt) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function setModelCache(models, syncedAt) {
  const payload = {
    syncedAt,
    models,
  };
  localStorage.setItem(LS_KEY_MODELS_CACHE, JSON.stringify(payload));
}

function parseOfficialModels(payload) {
  const models = Array.isArray(payload?.data) ? payload.data : [];
  return models
    .map((item) => {
      const id = String(item?.id ?? "").trim();
      if (!id) return null;
      const name = String(item?.name ?? "").trim();
      const promptPricePerToken = parsePricePerToken(item?.pricing?.prompt);
      const completionPricePerToken = parsePricePerToken(item?.pricing?.completion);
      return {
        id,
        name,
        promptPricePerToken,
        completionPricePerToken,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeHistoryItem(item) {
  if (!item || typeof item !== "object") return null;

  const selectedModels = Array.isArray(item.selectedModels)
    ? item.selectedModels.map((m) => String(m || "").trim()).filter(Boolean)
    : [];

  const rows = Array.isArray(item.rows)
    ? item.rows.map((r) => ({ prompt: String(r?.prompt ?? "") }))
    : [];

  return {
    id: typeof item.id === "string" && item.id ? item.id : createSnapshotId(),
    title: String(item.title || "未命名配置"),
    savedAt: Number(item.savedAt) || Date.now(),
    temperature: clampTemperature(Number(item.temperature)),
    outputTokenRatio: (() => {
      const value = Number(item.outputTokenRatio);
      if (Number.isNaN(value)) return 1;
      if (value < 0.1) return 0.1;
      if (value > 4) return 4;
      return value;
    })(),
    systemPrompt: String(item.systemPrompt || ""),
    selectedModels,
    rows,
  };
}

function readLocalHistoryBackup(workspaceId = getWorkspaceId()) {
  try {
    const raw = localStorage.getItem(LS_KEY_HISTORY_BACKUP);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const scoped = Array.isArray(parsed[workspaceId]) ? parsed[workspaceId] : [];
        return scoped.map(normalizeHistoryItem).filter(Boolean).slice(0, MAX_CONFIG_HISTORY);
      }
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeHistoryItem).filter(Boolean).slice(0, MAX_CONFIG_HISTORY);
      }
    }

    const legacy = localStorage.getItem(LS_KEY_HISTORY_LEGACY);
    if (!legacy) return [];
    const legacyParsed = JSON.parse(legacy);
    if (!Array.isArray(legacyParsed)) return [];
    return legacyParsed.map(normalizeHistoryItem).filter(Boolean).slice(0, MAX_CONFIG_HISTORY);
  } catch {
    return [];
  }
}

function writeLocalHistoryBackup(workspaceId = getWorkspaceId(), items = []) {
  let allWorkspaces = {};
  try {
    const raw = localStorage.getItem(LS_KEY_HISTORY_BACKUP);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        allWorkspaces = parsed;
      }
    }
  } catch {
    allWorkspaces = {};
  }

  allWorkspaces[workspaceId] = items;
  localStorage.setItem(LS_KEY_HISTORY_BACKUP, JSON.stringify(allWorkspaces));
}

async function fetchRemoteHistory(workspaceId) {
  const response = await fetch(`${HISTORY_API_ENDPOINT}?workspace=${encodeURIComponent(workspaceId)}`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.map(normalizeHistoryItem).filter(Boolean).slice(0, MAX_CONFIG_HISTORY);
}

async function pushRemoteHistory(workspaceId, items) {
  const response = await fetch(`${HISTORY_API_ENDPOINT}?workspace=${encodeURIComponent(workspaceId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  const saved = Array.isArray(payload?.items) ? payload.items : [];
  return saved.map(normalizeHistoryItem).filter(Boolean).slice(0, MAX_CONFIG_HISTORY);
}

async function loadConfigHistoryFromServer(options = {}) {
  const { silent = false } = options;
  const workspaceId = getWorkspaceId();

  try {
    const remoteItems = await fetchRemoteHistory(workspaceId);
    state.configHistory = remoteItems;
    writeLocalHistoryBackup(workspaceId, state.configHistory);
    renderHistoryList();
    if (!silent) {
      setStatus(`已加载服务端历史：${state.configHistory.length} 条`, "ok");
    }
  } catch (error) {
    state.configHistory = readLocalHistoryBackup(workspaceId);
    renderHistoryList();
    if (!silent) {
      setStatus(`服务端历史加载失败，使用本地兜底：${error instanceof Error ? error.message : String(error)}`, "warn");
    }
  }
}

async function persistConfigHistory(options = {}) {
  const { silent = true } = options;
  const workspaceId = getWorkspaceId();
  state.configHistory = state.configHistory.slice(0, MAX_CONFIG_HISTORY);
  writeLocalHistoryBackup(workspaceId, state.configHistory);

  try {
    const saved = await pushRemoteHistory(workspaceId, state.configHistory);
    state.configHistory = saved;
    writeLocalHistoryBackup(workspaceId, state.configHistory);
    renderHistoryList();
    if (!silent) {
      setStatus("历史配置已同步到服务端", "ok");
    }
  } catch (error) {
    if (!silent) {
      setStatus(`历史同步失败：${error instanceof Error ? error.message : String(error)}`, "warn");
    }
  }
}

function queueHistorySync(silent = true) {
  historySyncQueue = historySyncQueue.then(() => persistConfigHistory({ silent }));
  return historySyncQueue;
}

function buildConfigTitle(rows) {
  const firstPrompt = rows.find((row) => row.prompt.trim());
  if (!firstPrompt) {
    return "空白配置";
  }
  const compact = firstPrompt.prompt.trim().replace(/\s+/g, " ");
  return shortText(compact, 26);
}

function buildConfigSnapshot() {
  const rows = state.rows.map((row) => ({ prompt: row.prompt }));
  return {
    id: createSnapshotId(),
    title: buildConfigTitle(rows),
    savedAt: Date.now(),
    temperature: parseTemperature(),
    outputTokenRatio: parseOutputTokenRatio(),
    systemPrompt: el.systemPromptInput.value,
    selectedModels: [...state.selectedModels],
    rows,
  };
}

function configSignature(snapshot) {
  return JSON.stringify({
    temperature: snapshot.temperature,
    outputTokenRatio: snapshot.outputTokenRatio,
    systemPrompt: snapshot.systemPrompt,
    selectedModels: snapshot.selectedModels,
    rows: snapshot.rows.map((r) => r.prompt),
  });
}

function renderHistoryList() {
  el.historyList.innerHTML = "";

  if (!state.configHistory.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "暂无历史配置。点击“保存当前配置”创建第一条记录。";
    el.historyList.appendChild(empty);
    return;
  }

  for (const item of state.configHistory) {
    const card = el.historyItemTemplate.content.firstElementChild.cloneNode(true);

    card.querySelector(".history-title").textContent = item.title;
    card.querySelector(".history-title").title = item.title;

    const modelCount = item.selectedModels.filter(Boolean).length;
    const rowCount = item.rows.length;
    const hasSystemPrompt = item.systemPrompt.trim() ? " · 含 System Prompt" : "";

    card.querySelector(".history-meta").textContent =
      `${formatSyncTime(item.savedAt)} · 模型列 ${modelCount} · 轮次 ${rowCount} · T=${item.temperature} · 输出系数 ${item.outputTokenRatio}${hasSystemPrompt}`;

    const loadBtn = card.querySelector(".load-history-btn");
    loadBtn.disabled = state.running;
    loadBtn.addEventListener("click", () => {
      state.selectedModels = item.selectedModels.length ? [...item.selectedModels] : [""];
      state.rows = item.rows.length ? item.rows.map((row) => createRow(row.prompt)) : [createRow("")];
      el.systemPromptInput.value = item.systemPrompt;
      el.temperatureInput.value = String(clampTemperature(Number(item.temperature)));
      el.outputTokenRatioInput.value = String(item.outputTokenRatio ?? 1);
      clearResults(true);
      renderModelColumns();
      renderCaseTable();
      setStatus(`已载入历史配置：${item.title}`, "ok");
    });

    const deleteBtn = card.querySelector(".delete-history-btn");
    deleteBtn.disabled = state.running;
    deleteBtn.addEventListener("click", () => {
      state.configHistory = state.configHistory.filter((cfg) => cfg.id !== item.id);
      renderHistoryList();
      void queueHistorySync(false);
    });

    el.historyList.appendChild(card);
  }
}

function saveCurrentConfig(options = {}) {
  const { silent = false, source = "manual" } = options;
  const snapshot = buildConfigSnapshot();

  const hasAnyModel = snapshot.selectedModels.some((m) => m.trim());
  const hasAnyPrompt = snapshot.rows.some((row) => row.prompt.trim());
  const hasSystemPrompt = snapshot.systemPrompt.trim();
  if (!hasAnyModel && !hasAnyPrompt && !hasSystemPrompt) {
    if (!silent) {
      setStatus("当前配置为空，未保存", "warn");
    }
    return;
  }

  const latest = state.configHistory[0];
  if (latest && source === "auto" && configSignature(latest) === configSignature(snapshot)) {
    return;
  }

  state.configHistory.unshift(snapshot);
  state.configHistory = state.configHistory.slice(0, MAX_CONFIG_HISTORY);
  renderHistoryList();

  if (!silent) {
    setStatus("当前配置已保存，正在同步服务端...", "ok");
  }

  void queueHistorySync(source !== "manual");
}

function clearConfigHistory() {
  state.configHistory = [];
  renderHistoryList();
  void queueHistorySync(false);
}

function applyAvailableModels(models, syncedAt) {
  state.availableModels = models;
  state.modelSyncedAt = syncedAt;

  if (!state.selectedModels.length) {
    state.selectedModels = ["", ""];
  }

  if (!state.selectedModels.some(Boolean) && models.length) {
    state.selectedModels[0] = models[0].id;
    if (models[1]) {
      state.selectedModels[1] = models[1].id;
    }
  }

  renderModelColumns();
  renderCaseTable();
}

async function loadOfficialModels(forceNetwork = false) {
  const cache = getModelCache();
  const now = Date.now();
  const cacheUsable =
    cache && Array.isArray(cache.models) && cache.models.length > 0 && now - cache.syncedAt < MODEL_CACHE_MAX_AGE_MS;

  if (!forceNetwork && cacheUsable) {
    applyAvailableModels(cache.models, cache.syncedAt);
    setModelMeta(`模型库：${cache.models.length} 个（缓存） · ${formatSyncTime(cache.syncedAt)}`, "ok");
  }

  setModelMeta("正在同步 OpenRouter 官方模型库...");

  try {
    const response = await fetch(OPENROUTER_MODELS_ENDPOINT, { method: "GET" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const models = parseOfficialModels(payload);
    if (!models.length) {
      throw new Error("官方 API 返回模型为空");
    }

    applyAvailableModels(models, now);
    setModelCache(models, now);
    setModelMeta(`模型库：${models.length} 个（官方） · ${formatSyncTime(now)}`, "ok");
    setStatus("官方模型列表已更新", "ok");
    return;
  } catch (error) {
    if (state.availableModels.length) {
      setModelMeta(
        `官方接口暂不可用，使用缓存 ${state.availableModels.length} 个 · ${formatSyncTime(state.modelSyncedAt)}`,
        "err",
      );
      setStatus(`模型列表刷新失败：${error instanceof Error ? error.message : String(error)}`, "err");
      return;
    }

    const fallback = FALLBACK_MODELS.map((id) => ({
      id,
      name: id,
      promptPricePerToken: null,
      completionPricePerToken: null,
    }));
    applyAvailableModels(fallback, now);
    setModelMeta("官方接口不可用，已回退到内置模型", "err");
    setStatus(`模型列表刷新失败：${error instanceof Error ? error.message : String(error)}`, "err");
  }
}

function clearResults(silent = false) {
  for (const row of state.rows) {
    row.results = {};
  }
  renderCaseTable();
  if (!silent) {
    setStatus("已清空所有结果", "ok");
  }
}

function ensureRows() {
  if (!state.rows.length) {
    state.rows.push(createRow(""));
  }
}

function getModelById(modelId) {
  return state.availableModels.find((model) => model.id === modelId) || null;
}

function estimateTextTokens(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return 0;

  const cjkCount = (normalized.match(/[\u3400-\u9fff]/g) || []).length;
  const nonCjkCount = normalized.length - cjkCount;
  const rough = cjkCount * 1.15 + nonCjkCount / 4;
  return Math.max(1, Math.ceil(rough));
}

function estimateRunCostByModel(modelId, prompts, systemPromptTokens, outputRatio) {
  const model = getModelById(modelId);
  if (!model) return null;

  const inputPrice = model.promptPricePerToken;
  const outputPrice = model.completionPricePerToken;
  if (!Number.isFinite(inputPrice) || !Number.isFinite(outputPrice)) {
    return null;
  }

  let historyTokens = systemPromptTokens;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const promptText of prompts) {
    const promptTokens = estimateTextTokens(promptText);
    const roundInputTokens = historyTokens + promptTokens;
    const roundOutputTokens = Math.max(24, Math.ceil(promptTokens * outputRatio));

    totalInputTokens += roundInputTokens;
    totalOutputTokens += roundOutputTokens;
    historyTokens += promptTokens + roundOutputTokens;
  }

  const inputCost = totalInputTokens * inputPrice;
  const outputCost = totalOutputTokens * outputPrice;

  return {
    modelId,
    totalInputTokens,
    totalOutputTokens,
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    inputPrice,
    outputPrice,
  };
}

function renderCostEstimate() {
  const outputRatio = parseOutputTokenRatio();

  const selectedModels = getSelectedModels();
  const prompts = state.rows.map((row) => row.prompt.trim()).filter(Boolean);
  const systemPromptTokens = estimateTextTokens(el.systemPromptInput.value);

  if (!selectedModels.length || !prompts.length) {
    el.costSummary.textContent = "预估总花费：等待输入 Prompt 与模型";
    return;
  }

  const estimated = selectedModels
    .map((modelId) => estimateRunCostByModel(modelId, prompts, systemPromptTokens, outputRatio))
    .filter(Boolean);

  if (!estimated.length) {
    el.costSummary.textContent = "预估总花费：当前模型缺少定价数据（请刷新模型列表）";
    return;
  }

  const totalCost = estimated.reduce((sum, item) => sum + item.totalCost, 0);
  const totalInputTokens = estimated.reduce((sum, item) => sum + item.totalInputTokens, 0);
  const totalOutputTokens = estimated.reduce((sum, item) => sum + item.totalOutputTokens, 0);
  const details = estimated
    .map((item) => `${shortText(item.modelId, 20)}≈${formatUsd(item.totalCost, 5)}`)
    .join(" · ");

  const missingPricingCount = selectedModels.length - estimated.length;
  const missingTip = missingPricingCount > 0 ? `；${missingPricingCount} 个模型缺少定价` : "";

  el.costSummary.textContent =
    `预估总花费≈${formatUsd(totalCost, 5)}（输入 ${totalInputTokens} tok，输出 ${totalOutputTokens} tok，输出系数 ${outputRatio}，每轮至少 24 输出 tok${missingTip}）\n${details}`;
}

function renderModelColumns() {
  ensureModelColumns();
  el.modelColumns.innerHTML = "";

  for (let index = 0; index < state.selectedModels.length; index += 1) {
    const selectedModel = state.selectedModels[index];
    const card = el.modelColumnTemplate.content.firstElementChild.cloneNode(true);

    const title = card.querySelector(".model-column-title");
    title.textContent = `模型列 ${index + 1}`;

    const removeBtn = card.querySelector(".remove-col-btn");
    removeBtn.disabled = state.running || state.selectedModels.length <= 1;
    removeBtn.addEventListener("click", () => {
      if (state.selectedModels.length <= 1) {
        setStatus("至少保留一个模型列", "warn");
        return;
      }
      state.selectedModels.splice(index, 1);
      clearResults(true);
      renderModelColumns();
      renderCaseTable();
      setStatus("模型列已移除，结果已清空", "warn");
    });

    const select = card.querySelector(".model-select");
    select.disabled = state.running;

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "请选择模型";
    select.appendChild(placeholder);

    for (const model of state.availableModels) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = shortText(model.id, 48);
      option.title = model.name && model.name !== model.id ? `${model.id} · ${model.name}` : model.id;
      select.appendChild(option);
    }

    const existsInAvailable = state.availableModels.some((model) => model.id === selectedModel);
    if (selectedModel && !existsInAvailable) {
      const staleOption = document.createElement("option");
      staleOption.value = selectedModel;
      staleOption.textContent = `(历史模型) ${shortText(selectedModel, 34)}`;
      staleOption.title = selectedModel;
      select.appendChild(staleOption);
    }

    select.value = selectedModel;
    select.addEventListener("change", () => {
      state.selectedModels[index] = select.value;
      clearResults(true);
      renderCaseTable();
      setStatus("模型列已更新，结果已清空", "warn");
    });

    const pricingNode = card.querySelector(".model-pricing");
    const modelInfo = getModelById(selectedModel);
    if (modelInfo && Number.isFinite(modelInfo.promptPricePerToken) && Number.isFinite(modelInfo.completionPricePerToken)) {
      pricingNode.textContent =
        `输入 ${formatPricePerMillion(modelInfo.promptPricePerToken)} · 输出 ${formatPricePerMillion(
          modelInfo.completionPricePerToken,
        )}`;
    } else if (selectedModel) {
      pricingNode.textContent = "定价：暂无（可尝试刷新模型列表）";
    } else {
      pricingNode.textContent = "定价：先选择模型";
    }

    el.modelColumns.appendChild(card);
  }

  renderCostEstimate();
}

function ensureModelColumns() {
  if (!state.selectedModels.length) {
    state.selectedModels = [""];
  }
}

function renderCaseTable() {
  renderCaseTableHead();
  renderCaseTableBody();
}

function renderCaseTableHead() {
  el.caseTableHead.innerHTML = "";
  const tr = document.createElement("tr");

  const thRound = document.createElement("th");
  thRound.textContent = "轮次";
  tr.appendChild(thRound);

  const thPrompt = document.createElement("th");
  thPrompt.textContent = "Prompt";
  tr.appendChild(thPrompt);

  for (let index = 0; index < state.selectedModels.length; index += 1) {
    const modelId = state.selectedModels[index] || "未选择模型";
    const th = document.createElement("th");
    th.className = "model-head-cell";
    th.textContent = `列 ${index + 1} · ${shortText(modelId, 34)}`;
    th.title = modelId;
    tr.appendChild(th);
  }

  el.caseTableHead.appendChild(tr);
}

function renderCaseTableBody() {
  ensureRows();
  el.caseTableBody.innerHTML = "";

  state.rows.forEach((row, index) => {
    const tr = document.createElement("tr");

    const roundCell = document.createElement("td");
    roundCell.className = "round-cell";

    const roundTag = document.createElement("div");
    roundTag.className = "round-tag";
    roundTag.textContent = `Round ${index + 1}`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "small-btn";
    removeBtn.textContent = "删除";
    removeBtn.disabled = state.running || state.rows.length <= 1;
    removeBtn.addEventListener("click", () => {
      if (state.rows.length <= 1) {
        setStatus("至少保留一行轮次", "warn");
        return;
      }
      state.rows = state.rows.filter((item) => item.id !== row.id);
      renderCaseTable();
      setStatus("轮次已删除", "warn");
    });

    roundCell.appendChild(roundTag);
    roundCell.appendChild(removeBtn);
    tr.appendChild(roundCell);

    const promptCell = document.createElement("td");
    promptCell.className = "prompt-cell";

    const promptInput = document.createElement("textarea");
    promptInput.rows = 3;
    promptInput.placeholder = `输入第 ${index + 1} 轮 Prompt`;
    promptInput.value = row.prompt;
    promptInput.disabled = state.running;
    promptInput.addEventListener("input", () => {
      row.prompt = promptInput.value;
      renderCostEstimate();
    });

    promptCell.appendChild(promptInput);
    tr.appendChild(promptCell);

    for (const modelId of state.selectedModels) {
      const responseCell = document.createElement("td");
      responseCell.className = "response-cell";
      fillResponseCell(responseCell, row, modelId);
      tr.appendChild(responseCell);
    }

    el.caseTableBody.appendChild(tr);
  });

  renderCostEstimate();
}

function fillResponseCell(cell, row, modelId) {
  if (!modelId) {
    const p = document.createElement("p");
    p.className = "result-empty";
    p.textContent = "先在上方选择模型";
    cell.appendChild(p);
    return;
  }

  const result = row.results[modelId];
  if (!result) {
    const p = document.createElement("p");
    p.className = "result-empty";
    p.textContent = "待执行";
    cell.appendChild(p);
    return;
  }

  const meta = document.createElement("div");
  meta.className = "result-meta";

  if (result.skipped) {
    meta.classList.add("warn");
  } else if (result.ok) {
    meta.classList.add("ok");
  } else {
    meta.classList.add("err");
  }

  const tokenText = result.usage?.total_tokens ? ` · tokens: ${result.usage.total_tokens}` : "";
  const statusText = result.skipped ? "跳过" : result.ok ? "成功" : "失败";
  meta.textContent = `${statusText} · ${result.latencyMs}ms${tokenText}`;

  const content = document.createElement("pre");
  content.className = "result-content";
  content.textContent = result.content;

  cell.appendChild(meta);
  cell.appendChild(content);
}

function setBusy(running) {
  state.running = running;
  el.runWorkflowBtn.disabled = running;
  el.clearResultsBtn.disabled = running;
  el.exportBtn.disabled = running;
  el.refreshModelsBtn.disabled = running;
  el.addModelColBtn.disabled = running;
  el.outputTokenRatioInput.disabled = running;
  el.saveConfigBtn.disabled = running;
  el.clearHistoryBtn.disabled = running;
  el.importPromptBtn.disabled = running;
  el.promptFileInput.disabled = running;
  el.addRowBtn.disabled = running;
  el.clearRowsBtn.disabled = running;

  renderModelColumns();
  renderCaseTableBody();
  renderHistoryList();
}

function buildInitialHistory(systemPrompt) {
  if (!systemPrompt) return [];
  return [{ role: "system", content: systemPrompt }];
}

async function requestByModel({ apiKey, modelId, prompt, history, temperature }) {
  history.push({ role: "user", content: prompt });
  const start = performance.now();

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-Title": "OpenRouter Case Runner",
  };

  if (location.protocol.startsWith("http")) {
    headers["HTTP-Referer"] = location.origin;
  }

  const body = {
    model: modelId,
    messages: history,
    temperature,
    stream: false,
  };

  try {
    const response = await fetch(OPENROUTER_CHAT_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({}));
    const latencyMs = Math.round(performance.now() - start);

    if (!response.ok) {
      return {
        modelId,
        ok: false,
        skipped: false,
        latencyMs,
        usage: null,
        content: `请求失败(${response.status})：${payload?.error?.message ?? "未知错误"}`,
      };
    }

    const content = normalizeContent(payload?.choices?.[0]?.message?.content);
    history.push({ role: "assistant", content });

    return {
      modelId,
      ok: true,
      skipped: false,
      latencyMs,
      usage: payload?.usage ?? null,
      content,
    };
  } catch (error) {
    return {
      modelId,
      ok: false,
      skipped: false,
      latencyMs: Math.round(performance.now() - start),
      usage: null,
      content: `网络异常：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function runWorkflow() {
  if (state.running) return;

  const apiKey = el.apiKeyInput.value.trim();
  if (!apiKey) {
    setStatus("请先填写 OpenRouter API Key", "err");
    return;
  }

  if (hasDuplicateModels(state.selectedModels)) {
    setStatus("模型列不能重复，请选择不同模型", "err");
    return;
  }

  const selectedModels = getSelectedModels();
  if (!selectedModels.length) {
    setStatus("请至少选择一个模型列", "err");
    return;
  }

  const nonEmptyPromptCount = state.rows.filter((row) => row.prompt.trim()).length;
  if (nonEmptyPromptCount === 0) {
    setStatus("请至少填写一行 Prompt", "err");
    return;
  }

  saveApiKeyPreference();

  const systemPrompt = el.systemPromptInput.value.trim();
  const temperature = parseTemperature();
  el.temperatureInput.value = String(temperature);

  clearResults(true);
  setBusy(true);

  const histories = {};
  for (const modelId of selectedModels) {
    histories[modelId] = buildInitialHistory(systemPrompt);
  }

  let totalCalls = 0;
  let successCalls = 0;

  for (let rowIndex = 0; rowIndex < state.rows.length; rowIndex += 1) {
    const row = state.rows[rowIndex];
    const prompt = row.prompt.trim();

    if (!prompt) {
      for (const modelId of selectedModels) {
        row.results[modelId] = {
          modelId,
          ok: false,
          skipped: true,
          latencyMs: 0,
          usage: null,
          content: "(该轮 Prompt 为空，已跳过)",
        };
      }
      renderCaseTableBody();
      continue;
    }

    setStatus(`执行中：第 ${rowIndex + 1}/${state.rows.length} 轮`, "warn");

    const roundResults = await Promise.all(
      selectedModels.map((modelId) =>
        requestByModel({
          apiKey,
          modelId,
          prompt,
          history: histories[modelId],
          temperature,
        }),
      ),
    );

    for (const result of roundResults) {
      row.results[result.modelId] = result;
      totalCalls += 1;
      if (result.ok) {
        successCalls += 1;
      }
    }

    renderCaseTableBody();
  }

  setBusy(false);
  saveCurrentConfig({ silent: true, source: "auto" });
  setStatus(`执行完成：成功 ${successCalls}/${totalCalls}`, successCalls === totalCalls ? "ok" : "err");
}

function exportJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    config: {
      workspaceId: getWorkspaceId(),
      temperature: parseTemperature(),
      outputTokenRatio: parseOutputTokenRatio(),
      systemPrompt: el.systemPromptInput.value,
      selectedModels: state.selectedModels,
    },
    rows: state.rows,
    history: state.configHistory,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `openrouter-case-runner-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("已导出 JSON", "ok");
}

function addModelColumn() {
  state.selectedModels.push("");
  clearResults(true);
  renderModelColumns();
  renderCaseTable();
  setStatus("已新增模型列", "ok");
}

async function handlePromptFileSelected(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  input.value = "";

  if (!file) return;
  if (!isSupportedPromptFile(file.name)) {
    setStatus("仅支持导入 .md 或 .txt 文件", "err");
    return;
  }

  try {
    const content = await file.text();
    const prompts = parsePromptTextToRows(content);

    if (!prompts.length) {
      setStatus("文件内容为空，未导入", "warn");
      return;
    }

    state.rows = prompts.map((prompt) => createRow(prompt));
    clearResults(true);
    renderCaseTable();
    saveCurrentConfig({ silent: true, source: "auto" });
    setStatus(`已导入 ${prompts.length} 轮 Prompt：${file.name}`, "ok");
  } catch (error) {
    setStatus(`读取文件失败：${error instanceof Error ? error.message : String(error)}`, "err");
  }
}

function addRow() {
  state.rows.push(createRow(""));
  renderCaseTableBody();
}

function clearRows() {
  state.rows = [createRow("")];
  renderCaseTableBody();
  setStatus("已清空轮次，仅保留一行", "ok");
}

function handleWorkspaceChanged() {
  saveWorkspacePreference();
  void loadConfigHistoryFromServer({ silent: false });
}

function bindEvents() {
  el.runWorkflowBtn.addEventListener("click", runWorkflow);
  el.clearResultsBtn.addEventListener("click", () => clearResults(false));
  el.exportBtn.addEventListener("click", exportJson);
  el.refreshModelsBtn.addEventListener("click", () => loadOfficialModels(true));
  el.addModelColBtn.addEventListener("click", addModelColumn);
  el.saveConfigBtn.addEventListener("click", () => saveCurrentConfig({ silent: false, source: "manual" }));
  el.clearHistoryBtn.addEventListener("click", clearConfigHistory);
  el.importPromptBtn.addEventListener("click", () => el.promptFileInput.click());
  el.promptFileInput.addEventListener("change", handlePromptFileSelected);
  el.addRowBtn.addEventListener("click", addRow);
  el.clearRowsBtn.addEventListener("click", clearRows);

  el.rememberKeyInput.addEventListener("change", saveApiKeyPreference);
  el.apiKeyInput.addEventListener("blur", saveApiKeyPreference);
  el.workspaceInput.addEventListener("blur", handleWorkspaceChanged);
  el.workspaceInput.addEventListener("change", handleWorkspaceChanged);
  el.systemPromptInput.addEventListener("input", renderCostEstimate);
  el.outputTokenRatioInput.addEventListener("input", renderCostEstimate);
  el.outputTokenRatioInput.addEventListener("blur", () => {
    el.outputTokenRatioInput.value = String(parseOutputTokenRatio());
    renderCostEstimate();
  });
}

function init() {
  hydrateApiKeyPreference();
  hydrateWorkspacePreference();

  state.configHistory = readLocalHistoryBackup(getWorkspaceId());
  state.rows = [createRow("")];

  bindEvents();
  renderModelColumns();
  renderCaseTable();
  renderHistoryList();

  void loadConfigHistoryFromServer({ silent: true });
  void loadOfficialModels(false);
}

init();
