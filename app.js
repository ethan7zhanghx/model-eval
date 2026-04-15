const OPENROUTER_CHAT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";
const HISTORY_API_ENDPOINT = "/api/config-history";
const EXPERIMENTS_API_ENDPOINT = "/api/experiments";
const RUNS_API_ENDPOINT = "/api/runs";
const DEFAULT_WORKSPACE_ID = "ws-default";
const DEFAULT_PROJECT_ID = "proj-default";
const HISTORY_NAMESPACE = "default";

const PROVIDER_OPENROUTER = "openrouter";
const PROVIDER_CUSTOM = "custom";
const DEFAULT_CUSTOM_BASE_URL = "https://api.openai.com/v1/chat/completions";
const EVAL_TYPE_SINGLE_TURN = "single_turn";
const EVAL_TYPE_MULTI_TURN = "multi_turn";
const EVAL_TYPE_SCENARIO = "scenario";
const SOURCE_TYPE_MANUAL = "manual_prompt";
const SOURCE_TYPE_PROMPT_FILE = "prompt_file";
const SOURCE_TYPE_DATASET = "dataset_import";
const SOURCE_TYPE_SCENARIO = "scenario_session";
const SCORE_METHOD_NONE = "none";
const SCORE_METHOD_EXACT = "exact";
const SCORE_METHOD_JUDGE = "judge";
const MAX_MANUAL_SCORE = 5;
const DEFAULT_JUDGE_MODEL = "openai/gpt-4o-mini";
const DEFAULT_JUDGE_PROMPT = [
  "你是一名严格但公正的评测裁判。请基于用户问题、模型回答、参考答案给出 0-5 分评分。",
  "请仅输出 JSON，不要输出解释性前缀或 Markdown 代码块。",
  '{"score": 0-5, "accuracy": 0-5, "completeness": 0-5, "fluency": 0-5, "reason": "简短中文理由"}',
  "",
  "[Prompt]",
  "{{prompt}}",
  "",
  "[Response]",
  "{{response}}",
  "",
  "[Reference]",
  "{{reference}}",
].join("\n");

const LS_KEY_API = "or-comparator-api-key";
const LS_KEY_PROVIDER = "or-comparator-provider-v1";
const LS_KEY_CUSTOM_BASE_URL = "or-comparator-custom-base-url-v1";
const LS_KEY_MODELS_CACHE = "or-comparator-models-cache-v1";
const LS_KEY_HISTORY_BACKUP = "or-comparator-history-backup-v1";
const LS_KEY_HISTORY_LEGACY = "or-comparator-config-history-v1";
const LS_KEY_PAGE_CONTEXT = "or-comparator-page-context-v1";

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
  judgeRunning: false,
  modelSyncedAt: null,
  configHistory: [],
  currentWorkspaceId: DEFAULT_WORKSPACE_ID,
  currentProjectId: DEFAULT_PROJECT_ID,
  currentEvalType: EVAL_TYPE_SINGLE_TURN,
  currentSourceType: SOURCE_TYPE_MANUAL,
  currentExperimentId: null,
  currentExperimentTitle: "未保存",
  currentExperimentStatus: "draft",
  currentExperimentUpdatedAt: null,
  currentRunId: null,
  currentRunStatus: null,
  currentRunUpdatedAt: null,
  currentRunCompletedAt: null,
  scenarioSessions: [],
  scenarioSessionsScopeKey: "",
  scenarioSessionsLoading: false,
};

const el = {
  providerSelect: document.getElementById("providerSelect"),
  evalTypeSelect: document.getElementById("evalTypeSelect"),
  sourceTypeSelect: document.getElementById("sourceTypeSelect"),
  evalModeHint: document.getElementById("evalModeHint"),
  baseUrlRow: document.getElementById("baseUrlRow"),
  baseUrlInput: document.getElementById("baseUrlInput"),
  apiKeyLabel: document.getElementById("apiKeyLabel"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  temperatureInput: document.getElementById("temperatureInput"),
  rememberKeyInput: document.getElementById("rememberKeyInput"),
  systemPromptInput: document.getElementById("systemPromptInput"),
  outputTokenRatioInput: document.getElementById("outputTokenRatioInput"),
  runJudgeBtn: document.getElementById("runJudgeBtn"),
  globalScoreMethod: document.getElementById("globalScoreMethod"),
  judgeConfig: document.getElementById("judgeConfig"),
  judgeModelInput: document.getElementById("judgeModelInput"),
  judgePromptInput: document.getElementById("judgePromptInput"),
  scoreSummary: document.getElementById("scoreSummary"),
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
  openScenarioWorkbenchLink: document.getElementById("openScenarioWorkbenchLink"),
  openScenarioArchiveLink: document.getElementById("openScenarioArchiveLink"),
  refreshScenarioSessionsBtn: document.getElementById("refreshScenarioSessionsBtn"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  historyList: document.getElementById("historyList"),
  scenarioSessionsList: document.getElementById("scenarioSessionsList"),
  historyItemTemplate: document.getElementById("historyItemTemplate"),
  importPromptBtn: document.getElementById("importPromptBtn"),
  promptFileInput: document.getElementById("promptFileInput"),
  addRowBtn: document.getElementById("addRowBtn"),
  clearRowsBtn: document.getElementById("clearRowsBtn"),
  caseTableHead: document.getElementById("caseTableHead"),
  caseTableBody: document.getElementById("caseTableBody"),
  summaryProvider: document.getElementById("summaryProvider"),
  summaryModels: document.getElementById("summaryModels"),
  summaryCases: document.getElementById("summaryCases"),
  summaryMode: document.getElementById("summaryMode"),
  summaryHistory: document.getElementById("summaryHistory"),
  summaryState: document.getElementById("summaryState"),
  currentExperimentTitle: document.getElementById("currentExperimentTitle"),
  currentExperimentMeta: document.getElementById("currentExperimentMeta"),
  currentExperimentStatus: document.getElementById("currentExperimentStatus"),
  currentExperimentUpdatedAt: document.getElementById("currentExperimentUpdatedAt"),
  currentRunLabel: document.getElementById("currentRunLabel"),
  currentRunMeta: document.getElementById("currentRunMeta"),
  currentRunStatus: document.getElementById("currentRunStatus"),
  currentRunUpdatedAt: document.getElementById("currentRunUpdatedAt"),
};

let rowIdSeed = 1;
let historySyncQueue = Promise.resolve();
let runSyncQueue = Promise.resolve();

class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.detail = options.detail ?? null;
  }
}

function createRow(prompt = "", options = {}) {
  return {
    id: rowIdSeed++,
    prompt,
    scoreRef: typeof options.scoreRef === "string" ? options.scoreRef : "",
    results: options.results && typeof options.results === "object" ? { ...options.results } : {},
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

function normalizeProvider(value) {
  return value === PROVIDER_CUSTOM ? PROVIDER_CUSTOM : PROVIDER_OPENROUTER;
}

function normalizeEvalType(value) {
  if ([EVAL_TYPE_SINGLE_TURN, EVAL_TYPE_MULTI_TURN, EVAL_TYPE_SCENARIO].includes(value)) {
    return value;
  }
  return EVAL_TYPE_SINGLE_TURN;
}

function normalizeSourceType(value) {
  if ([SOURCE_TYPE_MANUAL, SOURCE_TYPE_PROMPT_FILE, SOURCE_TYPE_DATASET, SOURCE_TYPE_SCENARIO].includes(value)) {
    return value;
  }
  return SOURCE_TYPE_MANUAL;
}

function getEvalTypeLabel(value) {
  return ({
    [EVAL_TYPE_SINGLE_TURN]: "单轮样本",
    [EVAL_TYPE_MULTI_TURN]: "多轮对话",
    [EVAL_TYPE_SCENARIO]: "场景模拟",
  })[normalizeEvalType(value)] || "单轮样本";
}

function getSourceTypeLabel(value) {
  return ({
    [SOURCE_TYPE_MANUAL]: "手动输入",
    [SOURCE_TYPE_PROMPT_FILE]: "文本导入",
    [SOURCE_TYPE_DATASET]: "数据集导入",
    [SOURCE_TYPE_SCENARIO]: "场景工作台",
  })[normalizeSourceType(value)] || "手动输入";
}

function normalizeScoreMethod(value) {
  if ([SCORE_METHOD_NONE, SCORE_METHOD_EXACT, SCORE_METHOD_JUDGE].includes(value)) {
    return value;
  }
  return SCORE_METHOD_NONE;
}

function getScoreMethodLabel(value) {
  return ({
    [SCORE_METHOD_NONE]: "不评分",
    [SCORE_METHOD_EXACT]: "精确匹配",
    [SCORE_METHOD_JUDGE]: "LLM Judge",
  })[normalizeScoreMethod(value)] || "不评分";
}

function getCurrentScoreConfig() {
  return {
    scoreMethod: normalizeScoreMethod(el.globalScoreMethod?.value),
    judgeModel: String(el.judgeModelInput?.value || "").trim(),
    judgePrompt: String(el.judgePromptInput?.value || "").trim() || DEFAULT_JUDGE_PROMPT,
  };
}

function applyScoreConfigToForm(config = {}) {
  const scoreMethod = normalizeScoreMethod(config.scoreMethod);
  if (el.globalScoreMethod) {
    el.globalScoreMethod.value = scoreMethod;
  }
  if (el.judgeModelInput) {
    el.judgeModelInput.value = String(config.judgeModel || config.judgeModelId || "").trim() || DEFAULT_JUDGE_MODEL;
  }
  if (el.judgePromptInput) {
    el.judgePromptInput.value = String(config.judgePrompt || config.judgePromptTemplate || "").trim() || DEFAULT_JUDGE_PROMPT;
  }
}

function isScenarioMode() {
  return normalizeEvalType(state.currentEvalType) === EVAL_TYPE_SCENARIO
    || normalizeSourceType(state.currentSourceType) === SOURCE_TYPE_SCENARIO;
}

function syncExperimentModeState(options = {}) {
  const { prefer = "none" } = options;

  state.currentEvalType = normalizeEvalType(state.currentEvalType);
  state.currentSourceType = normalizeSourceType(state.currentSourceType);

  if (prefer === "eval" && state.currentEvalType !== EVAL_TYPE_SCENARIO && state.currentSourceType === SOURCE_TYPE_SCENARIO) {
    state.currentSourceType = SOURCE_TYPE_MANUAL;
  }

  if (prefer === "source" && state.currentSourceType !== SOURCE_TYPE_SCENARIO && state.currentEvalType === EVAL_TYPE_SCENARIO) {
    state.currentEvalType = EVAL_TYPE_SINGLE_TURN;
  }

  if (state.currentSourceType === SOURCE_TYPE_SCENARIO) {
    state.currentEvalType = EVAL_TYPE_SCENARIO;
  }

  if (state.currentEvalType === EVAL_TYPE_SCENARIO) {
    state.currentSourceType = SOURCE_TYPE_SCENARIO;
  }
}

function getEvalModeHintText() {
  syncExperimentModeState();

  if (isScenarioMode()) {
    return "场景模拟评测请在“场景评测”工作台执行；当前页主要负责统一对象归档、Run 关联与会话回跳。";
  }

  if (state.currentSourceType === SOURCE_TYPE_DATASET) {
    return "当前会把这次实验标记为“数据集导入”；后续 M1.2 会继续补齐 Dataset Version 与可复用资产能力。";
  }

  if (state.currentSourceType === SOURCE_TYPE_PROMPT_FILE) {
    return state.currentEvalType === EVAL_TYPE_MULTI_TURN
      ? "文本导入 + 多轮模式：会按行顺序串联上下文，适合连续对话或逐步追问。"
      : "文本导入 + 单轮模式：会把导入后的每一行视为独立样本，适合批量对比短问答。";
  }

  if (state.currentEvalType === EVAL_TYPE_MULTI_TURN) {
    return "多轮对话评测会把每一行作为一个连续环节，后续轮次会继承前面的用户输入与模型回答。";
  }

  return "单轮样本评测会把每一行视为独立样本，适合批量 prompt 对比；手动输入时可以逐条增删样本。";
}

function renderExperimentModeControls() {
  syncExperimentModeState();

  if (el.evalTypeSelect) {
    el.evalTypeSelect.value = normalizeEvalType(state.currentEvalType);
  }

  if (el.sourceTypeSelect) {
    el.sourceTypeSelect.value = normalizeSourceType(state.currentSourceType);
  }

  if (el.evalModeHint) {
    el.evalModeHint.textContent = getEvalModeHintText();
  }
}

function getRowUnitLabel() {
  if (state.currentEvalType === EVAL_TYPE_MULTI_TURN) return "环节";
  if (state.currentEvalType === EVAL_TYPE_SCENARIO) return "步骤";
  return "样本";
}

function getPromptPlaceholder(index) {
  const label = getRowUnitLabel();
  if (state.currentEvalType === EVAL_TYPE_MULTI_TURN) {
    return `输入第 ${index + 1} 个${label} Prompt`;
  }
  if (state.currentEvalType === EVAL_TYPE_SCENARIO) {
    return `当前为场景模式：建议转到场景工作台维护第 ${index + 1} 个${label}`;
  }
  return `输入第 ${index + 1} 条${label} Prompt`;
}

function getHistoryNamespace() {
  return state.currentProjectId || HISTORY_NAMESPACE;
}

function isUsingOpenRouter() {
  return normalizeProvider(el.providerSelect.value) === PROVIDER_OPENROUTER;
}

function sanitizeBaseUrl(value) {
  return String(value || "").trim();
}

function getChatEndpoint() {
  if (isUsingOpenRouter()) {
    return OPENROUTER_CHAT_ENDPOINT;
  }
  return sanitizeBaseUrl(el.baseUrlInput.value);
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

function updateWorkbenchSummary() {
  const modelCount = getSelectedModels().length;
  const promptCount = state.rows.filter((row) => row.prompt.trim()).length;
  const providerText = isUsingOpenRouter() ? "OpenRouter" : "自定义接口";
  syncExperimentModeState();
  const modeText = `${getEvalTypeLabel(state.currentEvalType)} · ${getSourceTypeLabel(state.currentSourceType)}`;

  let stateText = "待配置";
  if (state.running) {
    stateText = "执行中";
  } else if (state.judgeRunning) {
    stateText = "Judge 评分中";
  } else if (isScenarioMode()) {
    stateText = "场景跳转";
  } else if (modelCount > 0 && promptCount > 0) {
    stateText = "可执行";
  } else if (modelCount > 0 || promptCount > 0) {
    stateText = "待补全";
  }

  if (el.summaryProvider) el.summaryProvider.textContent = providerText;
  if (el.summaryModels) el.summaryModels.textContent = String(modelCount);
  if (el.summaryCases) el.summaryCases.textContent = String(promptCount);
  if (el.summaryMode) el.summaryMode.textContent = modeText;
  if (el.summaryHistory) el.summaryHistory.textContent = String(state.configHistory.length);
  if (el.summaryState) el.summaryState.textContent = stateText;
  renderEntityState();
}

function clampScore(value, max = MAX_MANUAL_SCORE) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(max, Number(num.toFixed(3))));
}

function normalizeComparableText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isScorableResult(result) {
  return !!result && !result.skipped && (!!result.ok || !!String(result.content || "").trim());
}

function applyExactScoreToResult(result, reference) {
  if (!result || !isScorableResult(result)) return null;
  const normalizedReference = normalizeComparableText(reference);
  if (!normalizedReference) {
    result.ruleScore = null;
    return null;
  }
  result.ruleScore = normalizeComparableText(result.content) === normalizedReference ? 1 : 0;
  return result.ruleScore;
}

function applyExactScoresForRows(rows = state.rows) {
  for (const row of rows) {
    for (const result of Object.values(row.results || {})) {
      applyExactScoreToResult(result, row.scoreRef || "");
    }
  }
}

function buildScoreSummaryText() {
  const scoreConfig = getCurrentScoreConfig();
  const stats = new Map();
  const rowsWithReference = state.rows.filter((row) => String(row.scoreRef || "").trim()).length;

  for (const row of state.rows) {
    for (const [modelId, result] of Object.entries(row.results || {})) {
      const current = stats.get(modelId) || {
        manualValues: [],
        judgeValues: [],
        exactValues: [],
      };
      if (result && result.manualScore != null) current.manualValues.push(result.manualScore);
      if (result && result.judgeScore != null) current.judgeValues.push(result.judgeScore);
      if (result && result.ruleScore != null) current.exactValues.push(result.ruleScore);
      stats.set(modelId, current);
    }
  }

  const lines = [
    `评分方式：${getScoreMethodLabel(scoreConfig.scoreMethod)}`,
    `评分参考：${rowsWithReference}/${state.rows.length} 行已填写`,
  ];

  if (!stats.size) {
    lines.push("当前还没有可汇总的评分结果。");
    return lines.join("\n");
  }

  const average = (values) => values.length
    ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)
    : null;

  for (const [modelId, item] of stats.entries()) {
    const parts = [];
    const manualAvg = average(item.manualValues);
    if (manualAvg != null) {
      parts.push(`人工 ${manualAvg} (${item.manualValues.length}条)`);
    }
    const judgeAvg = average(item.judgeValues);
    if (judgeAvg != null) {
      parts.push(`Judge ${judgeAvg} (${item.judgeValues.length}条)`);
    }
    if (item.exactValues.length) {
      const passRate = (item.exactValues.filter((value) => value >= 0.5).length / item.exactValues.length) * 100;
      parts.push(`精确匹配 ${passRate.toFixed(1)}% (${item.exactValues.length}条)`);
    }
    lines.push(`${shortText(modelId, 36)}：${parts.join(" · ") || "暂无评分"}`);
  }

  return lines.join("\n");
}

function updateScoreSummary() {
  if (!el.scoreSummary) return;
  el.scoreSummary.textContent = buildScoreSummaryText();
}

function renderScoreControls() {
  const scoreConfig = getCurrentScoreConfig();
  const showJudgeConfig = scoreConfig.scoreMethod === SCORE_METHOD_JUDGE;
  const hasResults = state.rows.some((row) => Object.values(row.results || {}).some((result) => isScorableResult(result)));

  if (el.globalScoreMethod) {
    el.globalScoreMethod.disabled = state.running || state.judgeRunning;
  }
  if (el.judgeConfig) {
    el.judgeConfig.classList.toggle("hidden", !showJudgeConfig);
  }
  if (el.judgeModelInput) {
    el.judgeModelInput.disabled = state.running || state.judgeRunning || !showJudgeConfig;
  }
  if (el.judgePromptInput) {
    el.judgePromptInput.disabled = state.running || state.judgeRunning || !showJudgeConfig;
  }
  if (el.runJudgeBtn) {
    el.runJudgeBtn.disabled = state.running || state.judgeRunning || !showJudgeConfig || !hasResults;
    el.runJudgeBtn.title = showJudgeConfig
      ? (hasResults ? "对当前结果执行或补跑 Judge 评分" : "请先运行实验，再执行 Judge")
      : "请先将评分方式切换为 LLM Judge";
  }

  updateScoreSummary();
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
  if (!ts) return "-";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function getExperimentStatusLabel(status) {
  return ({ draft: "草稿中", active: "已保存", archived: "已归档" })[status] || "草稿中";
}

function getRunStatusLabel(status) {
  return ({
    queued: "排队中",
    running: "执行中",
    partial_success: "部分完成",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  })[status] || "待执行";
}

function buildExperimentUrl(experimentId = state.currentExperimentId, runId = state.currentRunId) {
  const url = new URL(location.href);
  if (experimentId) {
    url.searchParams.set("experimentId", experimentId);
  } else {
    url.searchParams.delete("experimentId");
  }

  if (runId) {
    url.searchParams.set("runId", runId);
  } else {
    url.searchParams.delete("runId");
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

function buildScenarioWorkbenchUrl(options = {}) {
  const {
    workspaceId = state.currentWorkspaceId || DEFAULT_WORKSPACE_ID,
    projectId = state.currentProjectId || DEFAULT_PROJECT_ID,
    experimentId = state.currentExperimentId,
    runId = state.currentRunId,
    reportId = "",
    sessionId = "",
  } = options;

  const url = new URL("./zhumengdao/", location.href);
  url.searchParams.set("workspaceId", workspaceId || DEFAULT_WORKSPACE_ID);
  url.searchParams.set("projectId", projectId || DEFAULT_PROJECT_ID);

  if (experimentId) {
    url.searchParams.set("experimentId", experimentId);
  } else {
    url.searchParams.delete("experimentId");
  }

  if (runId) {
    url.searchParams.set("runId", runId);
  } else {
    url.searchParams.delete("runId");
  }

  if (reportId) {
    url.searchParams.set("reportId", reportId);
  } else {
    url.searchParams.delete("reportId");
  }

  if (sessionId) {
    url.searchParams.set("sessionId", sessionId);
  } else {
    url.searchParams.delete("sessionId");
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

function updateScenarioWorkbenchLink() {
  const href = buildScenarioWorkbenchUrl();
  if (el.openScenarioWorkbenchLink) {
    el.openScenarioWorkbenchLink.href = href;
  }
  if (el.openScenarioArchiveLink) {
    el.openScenarioArchiveLink.href = href;
  }
}

function persistPageContext() {
  const payload = {
    experimentId: state.currentExperimentId,
    runId: state.currentRunId,
  };
  localStorage.setItem(LS_KEY_PAGE_CONTEXT, JSON.stringify(payload));

  if (location.protocol.startsWith("http")) {
    window.history.replaceState({}, "", buildExperimentUrl(payload.experimentId, payload.runId));
  }
}

function readPersistedPageContext() {
  const fromUrl = new URLSearchParams(location.search);
  const experimentId = fromUrl.get("experimentId");
  const runId = fromUrl.get("runId");
  if (experimentId || runId) {
    return { experimentId, runId };
  }

  try {
    const raw = localStorage.getItem(LS_KEY_PAGE_CONTEXT);
    if (!raw) return { experimentId: null, runId: null };
    const parsed = JSON.parse(raw);
    return {
      experimentId: typeof parsed?.experimentId === "string" ? parsed.experimentId : null,
      runId: typeof parsed?.runId === "string" ? parsed.runId : null,
    };
  } catch {
    return { experimentId: null, runId: null };
  }
}

function setCurrentExperimentContext(item = null) {
  const previousScopeKey = getScenarioSessionsScopeKey();

  state.currentExperimentId = item?.id || null;
  state.currentExperimentTitle = item?.title || item?.name || "未保存";
  state.currentExperimentStatus = item?.status || "draft";
  state.currentEvalType = item ? normalizeEvalType(item.evalType) : EVAL_TYPE_SINGLE_TURN;
  state.currentSourceType = item ? normalizeSourceType(item.sourceType) : SOURCE_TYPE_MANUAL;
  state.currentExperimentUpdatedAt = item?.savedAt || item?.updatedAt || null;
  persistPageContext();

  if (previousScopeKey !== getScenarioSessionsScopeKey()) {
    state.scenarioSessionsScopeKey = "";
    void loadScenarioSessions({ silent: true });
  }
}

function setCurrentRunContext(item = null) {
  state.currentRunId = item?.id || null;
  state.currentRunStatus = item?.status || null;
  state.currentRunUpdatedAt = item?.updatedAt || item?.startedAt || item?.savedAt || null;
  state.currentRunCompletedAt = item?.completedAt || null;
  persistPageContext();
  renderScenarioSessions();
}

async function fetchExperimentById(id) {
  if (!id) return null;
  const payload = await requestHistoryApi(`${EXPERIMENTS_API_ENDPOINT}?id=${encodeURIComponent(id)}&projectId=${encodeURIComponent(state.currentProjectId)}`, {
    method: "GET",
  });
  return payload?.item ? normalizeHistoryItem(payload.item) : null;
}

async function fetchLatestRunForExperiment(experimentId) {
  if (!experimentId) return null;
  const payload = await requestHistoryApi(`${RUNS_API_ENDPOINT}?projectId=${encodeURIComponent(state.currentProjectId)}&experimentId=${encodeURIComponent(experimentId)}&limit=1`, {
    method: "GET",
  });
  const [item] = Array.isArray(payload?.items) ? payload.items : [];
  return item || null;
}

async function fetchRunById(id) {
  if (!id) return null;
  const payload = await requestHistoryApi(`${RUNS_API_ENDPOINT}?id=${encodeURIComponent(id)}&projectId=${encodeURIComponent(state.currentProjectId)}`, {
    method: "GET",
  });
  return payload?.item || null;
}

function hydrateRunIntoWorkbench(run) {
  if (!run || typeof run !== "object") return;

  state.currentEvalType = normalizeEvalType(run.evalType || state.currentEvalType);
  state.currentSourceType = normalizeSourceType(run.sourceType || state.currentSourceType);
  state.selectedModels = Array.isArray(run.config?.models) && run.config.models.length ? [...run.config.models] : [""];
  state.rows = Array.isArray(run.rows) && run.rows.length
    ? run.rows.map((row) => createRow(row.prompt || "", {
      scoreRef: row.scoreRef || "",
      results: row.results || {},
    }))
    : [createRow("")];

  el.systemPromptInput.value = String(run.config?.systemPrompt || "");
  el.temperatureInput.value = String(clampTemperature(Number(run.config?.temperature)));
  el.outputTokenRatioInput.value = String(Number.isFinite(Number(run.config?.outputTokenRatio)) ? Number(run.config.outputTokenRatio) : 1);
  el.providerSelect.value = normalizeProvider(run.config?.provider || el.providerSelect.value);
  el.baseUrlInput.value = sanitizeBaseUrl(run.config?.baseUrl) || DEFAULT_CUSTOM_BASE_URL;
  applyScoreConfigToForm({
    scoreMethod: run.config?.scoreMethod,
    judgeModel: run.config?.judgeModel || run.config?.judgeModelId,
    judgePrompt: run.config?.judgePrompt || run.config?.judgePromptTemplate,
  });

  updateProviderUI();
  renderExperimentModeControls();
  renderModelColumns();
  renderCaseTable();
  renderScoreControls();
}

async function hydratePlatformContext() {
  try {
    const payload = await requestHistoryApi("/api/bootstrap", { method: "GET" });
    state.currentWorkspaceId = payload?.workspace?.id || DEFAULT_WORKSPACE_ID;
    state.currentProjectId = payload?.project?.id || DEFAULT_PROJECT_ID;
  } catch {
    state.currentWorkspaceId = DEFAULT_WORKSPACE_ID;
    state.currentProjectId = DEFAULT_PROJECT_ID;
  }
  updateScenarioWorkbenchLink();
}

async function restorePageContext() {
  const context = readPersistedPageContext();
  if (!context.experimentId) {
    setCurrentExperimentContext(null);
    setCurrentRunContext(null);
    renderEntityState();
    return;
  }

  let experiment = state.configHistory.find((item) => item.id === context.experimentId) || null;
  if (!experiment) {
    try {
      experiment = await fetchExperimentById(context.experimentId);
    } catch {
      experiment = null;
    }
  }

  if (!experiment) {
    setCurrentExperimentContext(null);
    setCurrentRunContext(null);
    renderEntityState();
    return;
  }

  loadSnapshotIntoForm(experiment, { refreshRun: !context.runId });

  if (context.runId) {
    try {
      const run = await fetchRunById(context.runId);
      if (run) {
        hydrateRunIntoWorkbench(run);
      }
      setCurrentRunContext(run);
    } catch {
      await refreshCurrentRunContext();
    }
  } else {
    await refreshCurrentRunContext();
  }

  renderEntityState();
}

async function refreshCurrentRunContext() {
  try {
    const latestRun = await fetchLatestRunForExperiment(state.currentExperimentId);
    setCurrentRunContext(latestRun);
  } catch {
    setCurrentRunContext(null);
  }
  renderEntityState();
}

function getScenarioSessionsScopeKey() {
  return `${state.currentProjectId || DEFAULT_PROJECT_ID}::${state.currentExperimentId || "project"}`;
}

function renderScenarioSessions(options = {}) {
  if (!el.scenarioSessionsList) return;

  const { loading = false, error = "" } = options;
  if (el.refreshScenarioSessionsBtn) {
    el.refreshScenarioSessionsBtn.disabled = state.scenarioSessionsLoading;
  }

  el.scenarioSessionsList.innerHTML = "";

  if (loading && !state.scenarioSessions.length) {
    const loadingState = document.createElement("p");
    loadingState.className = "history-empty";
    loadingState.textContent = "正在加载场景评测归档...";
    el.scenarioSessionsList.appendChild(loadingState);
    return;
  }

  if (error && !state.scenarioSessions.length) {
    const errorState = document.createElement("p");
    errorState.className = "history-empty";
    errorState.textContent = "场景归档加载失败，请稍后重试。";
    el.scenarioSessionsList.appendChild(errorState);
    return;
  }

  if (!state.scenarioSessions.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "history-empty";
    emptyState.textContent = state.currentExperimentId
      ? "当前实验下暂无场景评测 session。"
      : "当前项目下暂无场景评测 session。";
    el.scenarioSessionsList.appendChild(emptyState);
    return;
  }

  for (const session of state.scenarioSessions) {
    const card = document.createElement("article");
    card.className = "history-item";

    const main = document.createElement("div");
    main.className = "history-main";

    const title = document.createElement("strong");
    title.className = "history-title";
    title.textContent = session.roleName || `Session ${shortText(session.id || "", 18)}`;
    title.title = session.id || "";

    const meta = document.createElement("p");
    meta.className = "history-meta";
    const modelLabel = [session?.config?.modelA || "-", session?.config?.modelB || "-"].join(" vs ");
    const metaParts = [
      formatSyncTime(session.updatedAt || session.createdAt),
      `${Number(session.turnCount) || 0} 轮`,
      modelLabel,
    ];
    if (session.linkedRunId) {
      metaParts.push(`Run ${shortText(session.linkedRunId, 16)}`);
    }
    if (!state.currentExperimentId && session.experimentId) {
      metaParts.push(`Experiment ${shortText(session.experimentId, 16)}`);
    }
    if (session.linkedRunId && state.currentRunId && session.linkedRunId === state.currentRunId) {
      metaParts.push("当前 Run");
    }
    meta.textContent = metaParts.join(" · ");

    const preview = document.createElement("p");
    preview.className = "history-meta";
    const firstUserMessage = Array.isArray(session.messages)
      ? session.messages.find((item) => item?.role === "user" && item?.type !== "compare" && String(item?.content || "").trim())
      : null;
    const previewText = firstUserMessage
      ? String(firstUserMessage.content || "").replace(/\s+/g, " ").trim()
      : "";
    preview.textContent = previewText
      ? `首条输入：${shortText(previewText, 56)}`
      : `Session ${shortText(session.id || "", 28)}`;

    main.append(title, meta, preview);

    const actions = document.createElement("div");
    actions.className = "actions-inline";

    const openLink = document.createElement("a");
    openLink.className = "small-link action-link";
    openLink.href = buildScenarioWorkbenchUrl({
      workspaceId: session.workspaceId || state.currentWorkspaceId,
      projectId: session.projectId || state.currentProjectId,
      experimentId: session.experimentId || state.currentExperimentId,
      runId: session.linkedRunId || state.currentRunId,
      reportId: session.reportId || "",
      sessionId: session.id || "",
    });
    openLink.textContent = session.linkedRunId && state.currentRunId && session.linkedRunId === state.currentRunId
      ? "继续评测"
      : "打开";

    actions.appendChild(openLink);
    card.append(main, actions);
    el.scenarioSessionsList.appendChild(card);
  }
}

async function loadScenarioSessions(options = {}) {
  const { silent = false, force = false } = options;
  if (!el.scenarioSessionsList) return [];

  const scopeKey = getScenarioSessionsScopeKey();
  if (!force && state.scenarioSessionsScopeKey === scopeKey) {
    renderScenarioSessions();
    return state.scenarioSessions;
  }

  state.scenarioSessionsLoading = true;
  renderScenarioSessions({ loading: true });

  let errorMessage = "";
  try {
    const url = new URL("/api/zhumengdao-sessions", location.origin);
    url.searchParams.set("projectId", state.currentProjectId || DEFAULT_PROJECT_ID);
    if (state.currentExperimentId) {
      url.searchParams.set("experimentId", state.currentExperimentId);
    }
    url.searchParams.set("limit", state.currentExperimentId ? "20" : "12");

    const payload = await requestHistoryApi(`${url.pathname}${url.search}`, { method: "GET" });
    state.scenarioSessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
    state.scenarioSessionsScopeKey = scopeKey;

    if (!silent) {
      const scopeLabel = state.currentExperimentId ? "当前实验" : "当前项目";
      setStatus(`已同步${scopeLabel}下的场景归档：${state.scenarioSessions.length} 条`, "ok");
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    state.scenarioSessions = [];
    state.scenarioSessionsScopeKey = scopeKey;

    if (!silent) {
      setStatus(`场景归档加载失败：${errorMessage}`, "warn");
    }
  } finally {
    state.scenarioSessionsLoading = false;
    renderScenarioSessions(errorMessage ? { error: errorMessage } : {});
  }

  return state.scenarioSessions;
}

function renderEntityState() {
  renderExperimentModeControls();
  updateScenarioWorkbenchLink();
  if (el.currentExperimentTitle) {
    el.currentExperimentTitle.textContent = state.currentExperimentTitle || "未保存";
  }
  if (el.currentExperimentMeta) {
    el.currentExperimentMeta.textContent = state.currentExperimentId
      ? `ID ${shortText(state.currentExperimentId, 24)}`
      : "新建实验";
  }
  if (el.currentExperimentStatus) {
    el.currentExperimentStatus.textContent = getExperimentStatusLabel(state.currentExperimentStatus);
  }
  if (el.currentExperimentUpdatedAt) {
    el.currentExperimentUpdatedAt.textContent = state.currentExperimentUpdatedAt
      ? `最近保存 ${formatSyncTime(state.currentExperimentUpdatedAt)}`
      : "尚未保存";
  }
  if (el.currentRunLabel) {
    el.currentRunLabel.textContent = state.currentRunId ? shortText(state.currentRunId, 24) : "未运行";
  }
  if (el.currentRunMeta) {
    el.currentRunMeta.textContent = state.currentRunId ? "当前实验最近一次运行" : "保存并启动后生成";
  }
  if (el.currentRunStatus) {
    el.currentRunStatus.textContent = getRunStatusLabel(state.currentRunStatus);
  }
  if (el.currentRunUpdatedAt) {
    if (state.currentRunCompletedAt) {
      el.currentRunUpdatedAt.textContent = `完成于 ${formatSyncTime(state.currentRunCompletedAt)}`;
    } else if (state.currentRunStatus === "running" && state.currentRunUpdatedAt) {
      el.currentRunUpdatedAt.textContent = `开始于 ${formatSyncTime(state.currentRunUpdatedAt)}`;
    } else if (state.currentRunStatus === "queued" && state.currentRunUpdatedAt) {
      el.currentRunUpdatedAt.textContent = `排队于 ${formatSyncTime(state.currentRunUpdatedAt)}`;
    } else if (state.currentRunUpdatedAt) {
      el.currentRunUpdatedAt.textContent = `最近更新 ${formatSyncTime(state.currentRunUpdatedAt)}`;
    } else {
      el.currentRunUpdatedAt.textContent = "暂无运行记录";
    }
  }
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

function saveProviderPreference() {
  localStorage.setItem(LS_KEY_PROVIDER, normalizeProvider(el.providerSelect.value));
}

function hydrateProviderPreference() {
  const saved = localStorage.getItem(LS_KEY_PROVIDER);
  el.providerSelect.value = normalizeProvider(saved);
}

function saveBaseUrlPreference() {
  const value = sanitizeBaseUrl(el.baseUrlInput.value);
  if (value) {
    localStorage.setItem(LS_KEY_CUSTOM_BASE_URL, value);
    return;
  }
  localStorage.removeItem(LS_KEY_CUSTOM_BASE_URL);
}

function hydrateBaseUrlPreference() {
  const saved = sanitizeBaseUrl(localStorage.getItem(LS_KEY_CUSTOM_BASE_URL));
  el.baseUrlInput.value = saved || DEFAULT_CUSTOM_BASE_URL;
}

function updateProviderUI() {
  const usingOpenRouter = isUsingOpenRouter();

  if (el.apiKeyLabel) {
    el.apiKeyLabel.textContent = usingOpenRouter ? "OpenRouter API Key" : "接口 API Key";
  }
  el.apiKeyInput.placeholder = usingOpenRouter ? "sk-or-v1-..." : "输入你的 API Key";

  if (el.baseUrlRow) {
    el.baseUrlRow.classList.toggle("hidden", usingOpenRouter);
  }

  if (usingOpenRouter) {
    el.refreshModelsBtn.disabled = state.running;
    updateWorkbenchSummary();
    return;
  }

  el.refreshModelsBtn.disabled = true;
  setModelMeta("当前是自定义接口模式：请在每个模型列手动输入模型 ID。", "ok");
  updateWorkbenchSummary();
}

function handleProviderChanged(options = {}) {
  const { silent = false } = options;
  el.providerSelect.value = normalizeProvider(el.providerSelect.value);
  saveProviderPreference();
  updateProviderUI();

  clearResults(true);
  if (isUsingOpenRouter()) {
    void loadOfficialModels(false);
    if (!silent) {
      setStatus("已切换为 OpenRouter 模式", "ok");
    }
    return;
  }

  state.availableModels = [];
  state.modelSyncedAt = null;
  renderModelColumns();
  renderCaseTable();
  if (!silent) {
    setStatus("已切换为自定义接口模式，请填写 Base URL 并手动输入模型 ID", "ok");
  }
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

  const rawConfig = item.config && typeof item.config === "object" ? item.config : {};
  const provider = normalizeProvider(rawConfig.provider || item.provider);
  const rawBaseUrl = sanitizeBaseUrl(rawConfig.baseUrl || item.baseUrl);

  const selectedModelsSource = Array.isArray(item.selectedModels) ? item.selectedModels : rawConfig.selectedModels;
  const selectedModels = Array.isArray(selectedModelsSource)
    ? selectedModelsSource.map((m) => String(m || "").trim()).filter(Boolean)
    : [];

  const rowsSource = Array.isArray(item.rows) ? item.rows : rawConfig.rows;
  const rows = Array.isArray(rowsSource)
    ? rowsSource.map((r) => ({
      prompt: String(r?.prompt ?? ""),
      scoreRef: String(r?.scoreRef ?? ""),
    }))
    : [];

  return {
    id: typeof item.id === "string" && item.id ? item.id : createSnapshotId(),
    title: String(item.title || item.name || "未命名配置"),
    status: String(item.status || "draft"),
    evalType: normalizeEvalType(item.evalType || rawConfig.evalType),
    sourceType: normalizeSourceType(item.sourceType || rawConfig.sourceType),
    savedAt: Number(item.savedAt || item.updatedAt) || Date.now(),
    temperature: clampTemperature(Number(rawConfig.temperature ?? item.temperature)),
    outputTokenRatio: (() => {
      const value = Number(rawConfig.outputTokenRatio ?? item.outputTokenRatio);
      if (Number.isNaN(value)) return 1;
      if (value < 0.1) return 0.1;
      if (value > 4) return 4;
      return value;
    })(),
    provider,
    baseUrl: provider === PROVIDER_CUSTOM ? rawBaseUrl || DEFAULT_CUSTOM_BASE_URL : "",
    systemPrompt: String(rawConfig.systemPrompt || item.systemPrompt || ""),
    scoreMethod: normalizeScoreMethod(rawConfig.scoreMethod || item.scoreMethod),
    judgeModel: String(rawConfig.judgeModel || rawConfig.judgeModelId || item.judgeModel || item.judgeModelId || "").trim() || DEFAULT_JUDGE_MODEL,
    judgePrompt: String(rawConfig.judgePrompt || rawConfig.judgePromptTemplate || item.judgePrompt || item.judgePromptTemplate || "").trim() || DEFAULT_JUDGE_PROMPT,
    selectedModels,
    rows,
  };
}

function readLocalHistoryBackup(namespace = getHistoryNamespace()) {
  try {
    const raw = localStorage.getItem(LS_KEY_HISTORY_BACKUP);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const scoped = Array.isArray(parsed[namespace]) ? parsed[namespace] : [];
        if (scoped.length) {
          return scoped.map(normalizeHistoryItem).filter(Boolean).slice(0, MAX_CONFIG_HISTORY);
        }

        const merged = Object.values(parsed)
          .flatMap((items) => (Array.isArray(items) ? items : []))
          .slice(0, MAX_CONFIG_HISTORY);
        return merged.map(normalizeHistoryItem).filter(Boolean).slice(0, MAX_CONFIG_HISTORY);
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

function writeLocalHistoryBackup(namespace = getHistoryNamespace(), items = []) {
  let allNamespaces = {};
  try {
    const raw = localStorage.getItem(LS_KEY_HISTORY_BACKUP);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        allNamespaces = parsed;
      }
    }
  } catch {
    allNamespaces = {};
  }

  allNamespaces[namespace] = items;
  localStorage.setItem(LS_KEY_HISTORY_BACKUP, JSON.stringify(allNamespaces));
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestHistoryApi(url, options) {
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

async function fetchRemoteHistory() {
  const payload = await requestHistoryApi(`${EXPERIMENTS_API_ENDPOINT}?projectId=${encodeURIComponent(state.currentProjectId)}&limit=${MAX_CONFIG_HISTORY}`, {
    method: "GET",
  });
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.map(normalizeHistoryItem).filter(Boolean).slice(0, MAX_CONFIG_HISTORY);
}

async function saveRemoteHistoryItem(snapshot) {
  const hasExisting = !!state.currentExperimentId;
  const endpoint = hasExisting
    ? `${EXPERIMENTS_API_ENDPOINT}?id=${encodeURIComponent(state.currentExperimentId)}&projectId=${encodeURIComponent(state.currentProjectId)}`
    : `${EXPERIMENTS_API_ENDPOINT}?projectId=${encodeURIComponent(state.currentProjectId)}`;

  const payload = await requestHistoryApi(endpoint, {
    method: hasExisting ? "PATCH" : "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      item: {
        id: hasExisting ? state.currentExperimentId : snapshot.id,
        title: snapshot.title,
        name: snapshot.title,
        status: state.currentExperimentStatus === "archived" ? "archived" : "active",
        evalType: snapshot.evalType,
        sourceType: snapshot.sourceType,
        savedAt: snapshot.savedAt,
        provider: snapshot.provider,
        baseUrl: snapshot.baseUrl,
        temperature: snapshot.temperature,
        outputTokenRatio: snapshot.outputTokenRatio,
        systemPrompt: snapshot.systemPrompt,
        scoreMethod: snapshot.scoreMethod,
        judgeModel: snapshot.judgeModel,
        judgePrompt: snapshot.judgePrompt,
        selectedModels: snapshot.selectedModels,
        rows: snapshot.rows,
        config: {
          provider: snapshot.provider,
          baseUrl: snapshot.baseUrl,
          temperature: snapshot.temperature,
          outputTokenRatio: snapshot.outputTokenRatio,
          systemPrompt: snapshot.systemPrompt,
          scoreMethod: snapshot.scoreMethod,
          judgeModel: snapshot.judgeModel,
          judgePrompt: snapshot.judgePrompt,
          selectedModels: snapshot.selectedModels,
          rows: snapshot.rows,
        },
      },
    }),
  });

  return normalizeHistoryItem(payload?.item);
}

async function deleteRemoteHistoryItem(id) {
  await requestHistoryApi(`${EXPERIMENTS_API_ENDPOINT}?id=${encodeURIComponent(id)}&projectId=${encodeURIComponent(state.currentProjectId)}`, {
    method: "DELETE",
  });
}

function upsertConfigHistoryItem(item) {
  if (!item) return null;
  const normalized = normalizeHistoryItem(item);
  if (!normalized) return null;
  state.configHistory = [normalized, ...state.configHistory.filter((cfg) => cfg.id !== normalized.id)]
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
    .slice(0, MAX_CONFIG_HISTORY);
  writeLocalHistoryBackup(getHistoryNamespace(), state.configHistory);
  return normalized;
}

function loadSnapshotIntoForm(item, options = {}) {
  const { refreshRun = true } = options;
  setCurrentExperimentContext(item);
  setCurrentRunContext(null);
  state.selectedModels = item.selectedModels.length ? [...item.selectedModels] : [""];
  state.rows = item.rows.length
    ? item.rows.map((row) => createRow(row.prompt, { scoreRef: row.scoreRef || "" }))
    : [createRow("")];
  el.systemPromptInput.value = item.systemPrompt;
  el.temperatureInput.value = String(clampTemperature(Number(item.temperature)));
  el.outputTokenRatioInput.value = String(item.outputTokenRatio ?? 1);
  el.providerSelect.value = normalizeProvider(item.provider);
  el.baseUrlInput.value = sanitizeBaseUrl(item.baseUrl) || DEFAULT_CUSTOM_BASE_URL;
  applyScoreConfigToForm(item);
  saveProviderPreference();
  saveBaseUrlPreference();
  updateProviderUI();
  renderScoreControls();
  if (isUsingOpenRouter()) {
    void loadOfficialModels(false);
  }
  clearResults(true);
  renderModelColumns();
  renderCaseTable();
  if (refreshRun) {
    void refreshCurrentRunContext();
  }
}

async function loadConfigHistoryFromServer(options = {}) {
  const { silent = false } = options;
  const namespace = getHistoryNamespace();

  try {
    const remoteItems = await fetchRemoteHistory();
    state.configHistory = remoteItems;
    writeLocalHistoryBackup(namespace, state.configHistory);
    renderHistoryList();
    if (!silent) {
      setStatus(`已加载实验草稿：${state.configHistory.length} 条`, "ok");
    }
  } catch (error) {
    state.configHistory = readLocalHistoryBackup(namespace);
    renderHistoryList();
    if (!silent) {
      setStatus(`实验草稿加载失败，使用本地兜底：${error instanceof Error ? error.message : String(error)}`, "warn");
    }
  }
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
  const rows = state.rows.map((row) => ({
    prompt: row.prompt,
    scoreRef: row.scoreRef || "",
  }));
  const provider = normalizeProvider(el.providerSelect.value);
  const scoreConfig = getCurrentScoreConfig();
  return {
    id: state.currentExperimentId || createSnapshotId(),
    title: buildConfigTitle(rows),
    status: state.currentExperimentStatus === "archived" ? "archived" : "active",
    evalType: normalizeEvalType(state.currentEvalType),
    sourceType: normalizeSourceType(state.currentSourceType),
    savedAt: Date.now(),
    temperature: parseTemperature(),
    outputTokenRatio: parseOutputTokenRatio(),
    provider,
    baseUrl: provider === PROVIDER_CUSTOM ? sanitizeBaseUrl(el.baseUrlInput.value) : "",
    systemPrompt: el.systemPromptInput.value,
    scoreMethod: scoreConfig.scoreMethod,
    judgeModel: scoreConfig.judgeModel,
    judgePrompt: scoreConfig.judgePrompt,
    selectedModels: [...state.selectedModels],
    rows,
  };
}

function configSignature(snapshot) {
  return JSON.stringify({
    status: snapshot.status,
    evalType: snapshot.evalType,
    sourceType: snapshot.sourceType,
    temperature: snapshot.temperature,
    outputTokenRatio: snapshot.outputTokenRatio,
    provider: snapshot.provider,
    baseUrl: snapshot.baseUrl,
    systemPrompt: snapshot.systemPrompt,
    scoreMethod: snapshot.scoreMethod,
    judgeModel: snapshot.judgeModel,
    judgePrompt: snapshot.judgePrompt,
    selectedModels: snapshot.selectedModels,
    rows: snapshot.rows.map((r) => ({ prompt: r.prompt, scoreRef: r.scoreRef || "" })),
  });
}

function renderHistoryList() {
  el.historyList.innerHTML = "";

  if (!state.configHistory.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "暂无历史配置。点击“保存当前配置”创建第一条记录。";
    el.historyList.appendChild(empty);
    updateWorkbenchSummary();
    return;
  }

  for (const item of state.configHistory) {
    const card = el.historyItemTemplate.content.firstElementChild.cloneNode(true);

    card.querySelector(".history-title").textContent = item.title;
    card.querySelector(".history-title").title = item.title;

    const modelCount = item.selectedModels.filter(Boolean).length;
    const rowCount = item.rows.length;
    const hasSystemPrompt = item.systemPrompt.trim() ? " · 含 System Prompt" : "";
    const providerText = item.provider === PROVIDER_CUSTOM ? "自定义接口" : "OpenRouter";
    const evalTypeText = getEvalTypeLabel(item.evalType);
    const sourceTypeText = getSourceTypeLabel(item.sourceType);
    const statusText = getExperimentStatusLabel(item.status);
    const scoreMethodText = getScoreMethodLabel(item.scoreMethod);

    card.querySelector(".history-meta").textContent =
      `${formatSyncTime(item.savedAt)} · ${statusText} · ${evalTypeText} · ${sourceTypeText} · ${providerText} · 评分 ${scoreMethodText} · 模型列 ${modelCount} · 环节 ${rowCount} · T=${item.temperature} · 输出系数 ${item.outputTokenRatio}${hasSystemPrompt}`;

    const loadBtn = card.querySelector(".load-history-btn");
    loadBtn.disabled = state.running;
    loadBtn.addEventListener("click", () => {
      loadSnapshotIntoForm(item);
      setStatus(`已载入历史配置：${item.title}`, "ok");
    });

    const deleteBtn = card.querySelector(".delete-history-btn");
    deleteBtn.disabled = state.running;
    deleteBtn.addEventListener("click", async () => {
      try {
        await deleteRemoteHistoryItem(item.id);
      } catch {
        // Keep local removal even if remote delete fails.
      }
      state.configHistory = state.configHistory.filter((cfg) => cfg.id !== item.id);
      if (state.currentExperimentId === item.id) {
        setCurrentExperimentContext(null);
        setCurrentRunContext(null);
      }
      writeLocalHistoryBackup(getHistoryNamespace(), state.configHistory);
      renderHistoryList();
    });

    el.historyList.appendChild(card);
  }

  updateWorkbenchSummary();
}

async function saveCurrentConfig(options = {}) {
  const { silent = false, source = "manual" } = options;
  const snapshot = buildConfigSnapshot();

  const hasAnyModel = snapshot.selectedModels.some((m) => m.trim());
  const hasAnyPrompt = snapshot.rows.some((row) => row.prompt.trim());
  const hasSystemPrompt = snapshot.systemPrompt.trim();
  if (!hasAnyModel && !hasAnyPrompt && !hasSystemPrompt) {
    if (!silent) {
      setStatus("当前配置为空，未保存", "warn");
    }
    return null;
  }

  const current = state.configHistory.find((cfg) => cfg.id === state.currentExperimentId) || state.configHistory[0];
  if (current && source === "auto" && configSignature(current) === configSignature(snapshot)) {
    return current;
  }

  try {
    const previousExperimentId = state.currentExperimentId;
    const saved = saveRemoteHistoryItem(snapshot);
    const resolved = upsertConfigHistoryItem(await saved);
    setCurrentExperimentContext(resolved || snapshot);
    if (previousExperimentId !== state.currentExperimentId) {
      setCurrentRunContext(null);
    }
    renderHistoryList();
    if (!silent) {
      setStatus("实验草稿已保存", "ok");
    }
    return resolved;
  } catch (error) {
    const previousExperimentId = state.currentExperimentId;
    const fallback = upsertConfigHistoryItem(snapshot);
    setCurrentExperimentContext(fallback || snapshot);
    if (previousExperimentId !== state.currentExperimentId) {
      setCurrentRunContext(null);
    }
    renderHistoryList();
    if (!silent) {
      setStatus(`服务端保存失败，已保存在本地：${error instanceof Error ? error.message : String(error)}`, "warn");
    }
    return fallback;
  }
}

async function clearConfigHistory() {
  state.configHistory = [];
  setCurrentExperimentContext(null);
  setCurrentRunContext(null);
  writeLocalHistoryBackup(getHistoryNamespace(), state.configHistory);
  renderHistoryList();
  try {
    await requestHistoryApi(`${HISTORY_API_ENDPOINT}?projectId=${encodeURIComponent(state.currentProjectId)}`, {
      method: "DELETE",
    });
    setStatus("已清空实验草稿", "ok");
  } catch (error) {
    setStatus(`已清空本地草稿，服务端清空失败：${error instanceof Error ? error.message : String(error)}`, "warn");
  }
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
  if (!isUsingOpenRouter()) {
    state.availableModels = [];
    state.modelSyncedAt = null;
    renderModelColumns();
    renderCaseTable();
    setModelMeta("当前是自定义接口模式：请在每个模型列手动输入模型 ID。", "ok");
    if (forceNetwork) {
      setStatus("自定义接口模式下不提供官方模型列表，请手动输入模型 ID", "warn");
    }
    return;
  }

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

  const isMultiTurn = state.currentEvalType === EVAL_TYPE_MULTI_TURN;
  let historyTokens = systemPromptTokens;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const promptText of prompts) {
    const promptTokens = estimateTextTokens(promptText);
    const roundInputTokens = (isMultiTurn ? historyTokens : systemPromptTokens) + promptTokens;
    const roundOutputTokens = Math.max(24, Math.ceil(promptTokens * outputRatio));

    totalInputTokens += roundInputTokens;
    totalOutputTokens += roundOutputTokens;
    if (isMultiTurn) {
      historyTokens += promptTokens + roundOutputTokens;
    }
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

  if (isScenarioMode()) {
    el.costSummary.textContent = "场景模拟请在“场景评测”工作台执行；当前页主要保留统一对象归档与跳转入口。";
    return;
  }

  if (!isUsingOpenRouter()) {
    el.costSummary.textContent = "预估总花费：自定义接口模式暂不自动估算（缺少统一定价来源）";
    return;
  }

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
  const usingOpenRouter = isUsingOpenRouter();

  for (let index = 0; index < state.selectedModels.length; index += 1) {
    const selectedModel = state.selectedModels[index];
    const card = el.modelColumnTemplate.content.firstElementChild.cloneNode(true);

    const title = card.querySelector(".model-column-title");
    title.textContent = `模型列 ${index + 1}`;

    const removeBtn = card.querySelector(".remove-col-btn");
    removeBtn.disabled = (state.running || state.judgeRunning) || state.selectedModels.length <= 1;
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
    if (usingOpenRouter) {
      select.disabled = state.running || state.judgeRunning;

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
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "model-input";
      input.placeholder = "手动输入模型 ID，例如 gpt-4o-mini";
      input.value = selectedModel;
      input.disabled = state.running || state.judgeRunning;
      input.addEventListener("blur", () => {
        const normalized = input.value.trim();
        input.value = normalized;
        state.selectedModels[index] = normalized;
        clearResults(true);
        renderCaseTable();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        input.blur();
      });
      select.replaceWith(input);
    }

    const pricingNode = card.querySelector(".model-pricing");
    if (!usingOpenRouter) {
      pricingNode.textContent = "自定义接口：定价不自动获取";
    } else {
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
    }

    el.modelColumns.appendChild(card);
  }

  renderCostEstimate();
  updateWorkbenchSummary();
  renderScoreControls();
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
  thRound.textContent = "环节";
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
    roundTag.textContent = `${getRowUnitLabel()} ${index + 1}`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "small-btn";
    removeBtn.textContent = "删除";
    removeBtn.disabled = (state.running || state.judgeRunning) || state.rows.length <= 1;
    removeBtn.addEventListener("click", () => {
      if (state.rows.length <= 1) {
        setStatus("至少保留 1 行输入", "warn");
        return;
      }
      state.rows = state.rows.filter((item) => item.id !== row.id);
      renderCaseTable();
      setStatus("当前行已删除", "warn");
    });

    roundCell.appendChild(roundTag);
    roundCell.appendChild(removeBtn);
    tr.appendChild(roundCell);

    const promptCell = document.createElement("td");
    promptCell.className = "prompt-cell";

    const promptInput = document.createElement("textarea");
    promptInput.rows = 3;
    promptInput.placeholder = getPromptPlaceholder(index);
    promptInput.value = row.prompt;
    promptInput.disabled = state.running || state.judgeRunning;
    promptInput.addEventListener("input", () => {
      row.prompt = promptInput.value;
      renderCostEstimate();
    });

    promptCell.appendChild(promptInput);

    const scoreRefInput = document.createElement("textarea");
    scoreRefInput.rows = 2;
    scoreRefInput.className = "score-ref-input";
    scoreRefInput.placeholder = "参考答案 / 评分参考（用于精确匹配或 Judge）";
    scoreRefInput.value = row.scoreRef || "";
    scoreRefInput.disabled = state.running || state.judgeRunning;
    scoreRefInput.addEventListener("input", () => {
      row.scoreRef = scoreRefInput.value;
      updateScoreSummary();
    });
    scoreRefInput.addEventListener("blur", () => {
      row.scoreRef = scoreRefInput.value;
      if (getCurrentScoreConfig().scoreMethod === SCORE_METHOD_EXACT) {
        applyExactScoresForRows([row]);
        renderCaseTableBody();
        void queuePersistCurrentRunSnapshot({ silent: true });
      } else {
        updateScoreSummary();
      }
      if (state.currentExperimentId) {
        void saveCurrentConfig({ silent: true, source: "auto" });
      }
    });
    promptCell.appendChild(scoreRefInput);
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
  updateWorkbenchSummary();
  renderScoreControls();
}

function createScoreBadge(label, className, title = "") {
  const badge = document.createElement("span");
  badge.className = `score-badge ${className}`;
  badge.textContent = label;
  if (title) {
    badge.title = title;
  }
  return badge;
}

function fillResponseCell(cell, row, modelId) {
  cell.innerHTML = "";
  if (!modelId) {
    const p = document.createElement("p");
    p.className = "result-empty";
    p.textContent = isUsingOpenRouter() ? "先在上方选择模型" : "先在上方填写模型 ID";
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

  const latencyText = result.latencyMs == null ? "-" : `${result.latencyMs}`;
  const tokenText = result.usage?.total_tokens ? ` · tokens: ${result.usage.total_tokens}` : "";
  const statusText = result.skipped ? "跳过" : result.ok ? "成功" : "失败";
  meta.textContent = `${statusText} · ${latencyText}ms${tokenText}`;

  const content = document.createElement("pre");
  content.className = "result-content";
  content.textContent = result.content;

  cell.appendChild(meta);
  cell.appendChild(content);

  const scoreRow = document.createElement("div");
  scoreRow.className = "score-row";

  if (result.ruleScore != null) {
    scoreRow.appendChild(createScoreBadge(
      result.ruleScore >= 0.5 ? "精确匹配通过" : "精确匹配未命中",
      result.ruleScore >= 0.5 ? "score-pass" : "score-fail",
    ));
  }

  if (result.judgeScore != null) {
    const reason = String(result.judgeDetail?.reason || "").trim();
    scoreRow.appendChild(createScoreBadge(
      `Judge ${Number(result.judgeScore).toFixed(2)}/5`,
      "score-judge",
      reason,
    ));
  } else if (result.judgeDetail?.reason) {
    scoreRow.appendChild(createScoreBadge("Judge 失败", "score-fail", result.judgeDetail.reason));
  }

  if (!result.skipped) {
    const manualWrap = document.createElement("div");
    manualWrap.className = "manual-score-wrap";

    for (let value = 1; value <= MAX_MANUAL_SCORE; value += 1) {
      const starBtn = document.createElement("button");
      starBtn.type = "button";
      starBtn.className = "score-star";
      if (result.manualScore != null && Number(result.manualScore) >= value) {
        starBtn.classList.add("active");
      }
      starBtn.textContent = "★";
      starBtn.disabled = state.running || state.judgeRunning;
      starBtn.title = `人工打 ${value} 星`;
      starBtn.addEventListener("click", () => {
        result.manualScore = result.manualScore === value ? null : value;
        fillResponseCell(cell, row, modelId);
        updateScoreSummary();
        void queuePersistCurrentRunSnapshot({ silent: true });
      });
      manualWrap.appendChild(starBtn);
    }

    const label = document.createElement("span");
    label.className = "manual-score-label";
    label.textContent = result.manualScore != null ? `人工 ${result.manualScore}/5` : "人工评分";
    manualWrap.appendChild(label);
    scoreRow.appendChild(manualWrap);
  }

  if (scoreRow.childNodes.length) {
    cell.appendChild(scoreRow);
  }
}

function setBusy(running) {
  state.running = running;
  if (running) {
    state.currentRunStatus = "running";
  }
  el.runWorkflowBtn.disabled = running;
  el.clearResultsBtn.disabled = running;
  el.exportBtn.disabled = running;
  el.refreshModelsBtn.disabled = running;
  el.addModelColBtn.disabled = running;
  el.outputTokenRatioInput.disabled = running;
  el.providerSelect.disabled = running;
  el.baseUrlInput.disabled = running;
  el.saveConfigBtn.disabled = running;
  el.clearHistoryBtn.disabled = running;
  el.importPromptBtn.disabled = running;
  el.promptFileInput.disabled = running;
  el.addRowBtn.disabled = running;
  el.clearRowsBtn.disabled = running;

  renderModelColumns();
  renderCaseTableBody();
  renderHistoryList();
  updateProviderUI();
  updateWorkbenchSummary();
}

function buildInitialHistory(systemPrompt) {
  if (!systemPrompt) return [];
  return [{ role: "system", content: systemPrompt }];
}

async function requestByModel({ apiKey, modelId, prompt, history, temperature, provider, endpoint }) {
  history.push({ role: "user", content: prompt });
  const start = performance.now();

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (provider === PROVIDER_OPENROUTER) {
    headers["X-Title"] = "OpenRouter Case Runner";
  }

  if (provider === PROVIDER_OPENROUTER && location.protocol.startsWith("http")) {
    headers["HTTP-Referer"] = location.origin;
  }

  const body = {
    model: modelId,
    messages: history,
    temperature,
    stream: false,
  };

  try {
    const response = await fetch(endpoint, {
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

function buildJudgePrompt(template, values = {}) {
  return String(template || DEFAULT_JUDGE_PROMPT)
    .replace(/{{\s*prompt\s*}}/gi, values.prompt || "")
    .replace(/{{\s*response\s*}}/gi, values.response || "")
    .replace(/{{\s*reference\s*}}/gi, values.reference || "");
}

function extractFirstJsonObject(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return null;

  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : normalized;
  try {
    return JSON.parse(candidate);
  } catch {
    // Fall through to best-effort object extraction.
  }

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const objectText = candidate.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(objectText);
    } catch {
      return null;
    }
  }

  return null;
}

function parseJudgePayload(content) {
  const parsed = extractFirstJsonObject(content);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Judge 未返回可解析 JSON");
  }

  const accuracy = clampScore(parsed.accuracy);
  const completeness = clampScore(parsed.completeness);
  const fluency = clampScore(parsed.fluency);
  let score = clampScore(parsed.score ?? parsed.overallScore ?? parsed.totalScore);

  if (score == null) {
    const dimensionValues = [accuracy, completeness, fluency].filter((value) => value != null);
    if (dimensionValues.length) {
      score = clampScore(dimensionValues.reduce((sum, value) => sum + value, 0) / dimensionValues.length);
    }
  }

  if (score == null) {
    throw new Error("Judge JSON 缺少 score 字段");
  }

  return {
    score,
    detail: {
      accuracy,
      completeness,
      fluency,
      reason: String(parsed.reason || parsed.comment || parsed.explanation || "").trim().slice(0, 500),
    },
  };
}

async function requestJudgeScore({ apiKey, provider, endpoint, judgeModel, judgePrompt, prompt, response, reference }) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (provider === PROVIDER_OPENROUTER) {
    headers["X-Title"] = "OpenRouter Judge Runner";
  }

  if (provider === PROVIDER_OPENROUTER && location.protocol.startsWith("http")) {
    headers["HTTP-Referer"] = location.origin;
  }

  const compiledPrompt = buildJudgePrompt(judgePrompt, {
    prompt,
    response,
    reference,
  });

  const responseObj = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: judgeModel,
      messages: [{ role: "user", content: compiledPrompt }],
      temperature: 0,
      stream: false,
    }),
  });

  const payload = await responseObj.json().catch(() => ({}));
  if (!responseObj.ok) {
    throw new Error(payload?.error?.message || `HTTP ${responseObj.status}`);
  }

  return parseJudgePayload(normalizeContent(payload?.choices?.[0]?.message?.content));
}

async function scoreRowsWithJudge(rows, options = {}) {
  const { apiKey, provider, endpoint, judgeModel, judgePrompt, silent = false } = options;
  const targets = [];

  rows.forEach((row, rowIndex) => {
    for (const [modelId, result] of Object.entries(row.results || {})) {
      if (!isScorableResult(result)) continue;
      targets.push({ row, rowIndex, modelId, result });
    }
  });

  if (!targets.length) {
    if (!silent) {
      setStatus("当前没有可供 Judge 评分的结果", "warn");
    }
    return { success: 0, total: 0 };
  }

  let success = 0;
  state.judgeRunning = true;
  renderScoreControls();

  try {
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      setStatus(`Judge 评分中：${index + 1}/${targets.length} · ${shortText(target.modelId, 28)}`, "warn");
      try {
        const judged = await requestJudgeScore({
          apiKey,
          provider,
          endpoint,
          judgeModel,
          judgePrompt,
          prompt: target.row.prompt || "",
          response: target.result.content || "",
          reference: target.row.scoreRef || "",
        });
        target.result.judgeScore = judged.score;
        target.result.judgeDetail = judged.detail;
        success += 1;
      } catch (error) {
        target.result.judgeScore = null;
        target.result.judgeDetail = {
          accuracy: null,
          completeness: null,
          fluency: null,
          reason: `Judge 失败：${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
        };
      }
      renderCaseTableBody();
    }
  } finally {
    state.judgeRunning = false;
    renderScoreControls();
  }

  return { success, total: targets.length };
}

async function runJudgeForCurrentResults(options = {}) {
  const { silent = false, persist = true } = options;
  if (state.running || state.judgeRunning) return { success: 0, total: 0 };

  const scoreConfig = getCurrentScoreConfig();
  if (scoreConfig.scoreMethod !== SCORE_METHOD_JUDGE) {
    if (!silent) {
      setStatus("请先将评分方式切换为 LLM Judge", "warn");
    }
    return { success: 0, total: 0 };
  }

  const apiKey = el.apiKeyInput.value.trim();
  if (!apiKey) {
    if (!silent) {
      setStatus("运行 Judge 前请先填写 API Key", "err");
    }
    return { success: 0, total: 0 };
  }

  const endpoint = getChatEndpoint();
  if (!endpoint) {
    if (!silent) {
      setStatus("运行 Judge 前请先填写 Base URL", "err");
    }
    return { success: 0, total: 0 };
  }

  if (!scoreConfig.judgeModel) {
    if (!silent) {
      setStatus("请先填写 Judge 模型 ID", "err");
    }
    return { success: 0, total: 0 };
  }

  const result = await scoreRowsWithJudge(state.rows, {
    apiKey,
    provider: normalizeProvider(el.providerSelect.value),
    endpoint,
    judgeModel: scoreConfig.judgeModel,
    judgePrompt: scoreConfig.judgePrompt,
    silent,
  });

  if (persist) {
    await queuePersistCurrentRunSnapshot({ silent: true });
  }

  if (!silent) {
    const statusType = result.success === result.total ? "ok" : (result.success > 0 ? "warn" : "err");
    setStatus(`Judge 完成：成功 ${result.success}/${result.total}`, statusType);
  }

  renderCaseTableBody();
  return result;
}

function getRunCompletionStatus(successCalls, totalCalls) {
  if (totalCalls <= 0 || successCalls <= 0) return "failed";
  if (successCalls === totalCalls) return "completed";
  return "partial_success";
}

function serializeRunRows() {
  return state.rows.map((row) => ({
    prompt: row.prompt,
    scoreRef: row.scoreRef || "",
    results: row.results,
  }));
}

async function persistRunRecord(options) {
  const {
    id,
    experimentId,
    provider,
    endpoint,
    selectedModels,
    systemPrompt,
    temperature,
    outputTokenRatio,
    status,
    startedAt = null,
    completedAt = null,
    rows = serializeRunRows(),
    successCalls,
    totalCalls,
  } = options;

  const hasExisting = !!id;
  const scoreConfig = getCurrentScoreConfig();

  const payload = {
    item: {
      ...(hasExisting ? { id } : {}),
      workspaceId: state.currentWorkspaceId,
      projectId: state.currentProjectId,
      experimentId,
      evalType: normalizeEvalType(state.currentEvalType),
      sourceType: normalizeSourceType(state.currentSourceType),
      name: `${buildConfigTitle(state.rows)} · Run`,
      status,
      triggerSource: "manual",
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      config: {
        provider,
        baseUrl: endpoint,
        models: [...selectedModels],
        systemPrompt,
        temperature,
        outputTokenRatio,
        scoreMethod: scoreConfig.scoreMethod,
        judgeModel: scoreConfig.judgeModel,
        judgePrompt: scoreConfig.judgePrompt,
      },
      rows,
      summary: {
        rowCount: rows.length,
        modelCount: selectedModels.length,
        successCalls,
        totalCalls,
      },
    },
  };

  const response = await requestHistoryApi(
    hasExisting
      ? `${RUNS_API_ENDPOINT}?id=${encodeURIComponent(id)}&projectId=${encodeURIComponent(state.currentProjectId)}`
      : `${RUNS_API_ENDPOINT}?projectId=${encodeURIComponent(state.currentProjectId)}`,
    {
      method: hasExisting ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  return response?.item ?? null;
}

function computeSuccessStats(rows = state.rows) {
  let totalCalls = 0;
  let successCalls = 0;

  for (const row of rows) {
    for (const result of Object.values(row.results || {})) {
      if (!result || result.skipped) continue;
      totalCalls += 1;
      if (result.ok) {
        successCalls += 1;
      }
    }
  }

  return { successCalls, totalCalls };
}

async function persistCurrentRunSnapshot(options = {}) {
  if (!state.currentRunId || !state.currentExperimentId) return null;

  const provider = normalizeProvider(el.providerSelect.value);
  const endpoint = getChatEndpoint();
  const selectedModels = getSelectedModels();
  const { successCalls, totalCalls } = computeSuccessStats();
  const payload = {
    id: state.currentRunId,
    experimentId: state.currentExperimentId,
    provider,
    endpoint,
    selectedModels,
    systemPrompt: el.systemPromptInput.value.trim(),
    temperature: parseTemperature(),
    outputTokenRatio: parseOutputTokenRatio(),
    status: state.currentRunStatus || getRunCompletionStatus(successCalls, totalCalls),
    rows: serializeRunRows(),
    successCalls,
    totalCalls,
  };

  const savedRun = await persistRunRecord(payload);
  if (savedRun) {
    setCurrentRunContext(savedRun);
  }
  renderEntityState();
  if (!options.silent) {
    setStatus("当前 Run 评分已保存", "ok");
  }
  return savedRun;
}

function queuePersistCurrentRunSnapshot(options = {}) {
  runSyncQueue = runSyncQueue
    .catch(() => null)
    .then(() => persistCurrentRunSnapshot(options).catch((error) => {
      if (!options.silent) {
        setStatus(`Run 保存失败：${error instanceof Error ? error.message : String(error)}`, "warn");
      }
      return null;
    }));
  return runSyncQueue;
}

async function runWorkflow() {
  if (state.running || state.judgeRunning) return;

  syncExperimentModeState();
  if (isScenarioMode()) {
    updateScenarioWorkbenchLink();
    setStatus("场景模拟请在“场景评测”工作台执行；当前页用于统一归档与实验 / Run 关联。", "warn");
    return;
  }

  const provider = normalizeProvider(el.providerSelect.value);
  const apiKey = el.apiKeyInput.value.trim();
  if (!apiKey) {
    setStatus("请先填写 API Key", "err");
    return;
  }

  const endpoint = getChatEndpoint();
  if (!endpoint) {
    setStatus("请先填写 Base URL", "err");
    return;
  }

  if (!/^https?:\/\//i.test(endpoint)) {
    setStatus("Base URL 必须以 http:// 或 https:// 开头", "err");
    return;
  }

  if (hasDuplicateModels(state.selectedModels)) {
    setStatus("模型列不能重复，请填写不同模型", "err");
    return;
  }

  const selectedModels = getSelectedModels();
  if (!selectedModels.length) {
    setStatus(provider === PROVIDER_OPENROUTER ? "请至少选择一个模型列" : "请至少填写一个模型 ID", "err");
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
  const outputTokenRatio = parseOutputTokenRatio();
  const scoreConfig = getCurrentScoreConfig();
  el.temperatureInput.value = String(temperature);

  if (scoreConfig.scoreMethod === SCORE_METHOD_JUDGE && !scoreConfig.judgeModel) {
    setStatus("请先填写 Judge 模型 ID", "err");
    return;
  }

  const savedExperiment = await saveCurrentConfig({ silent: true, source: "auto" });
  const experimentId = savedExperiment?.id || state.currentExperimentId;

  clearResults(true);

  let activeRun = null;
  let runRecordWarning = null;
  try {
    activeRun = await persistRunRecord({
      experimentId,
      provider,
      endpoint,
      selectedModels,
      systemPrompt,
      temperature,
      outputTokenRatio,
      status: "queued",
      rows: serializeRunRows(),
      successCalls: 0,
      totalCalls: 0,
    });
    setCurrentRunContext(activeRun);
    renderEntityState();
  } catch (error) {
    runRecordWarning = `运行记录初始化失败：${error instanceof Error ? error.message : String(error)}`;
  }

  setBusy(true);
  const runStartedAt = Date.now();

  if (activeRun?.id) {
    try {
      activeRun = await persistRunRecord({
        id: activeRun.id,
        experimentId,
        provider,
        endpoint,
        selectedModels,
        systemPrompt,
        temperature,
        outputTokenRatio,
        status: "running",
        startedAt: runStartedAt,
        rows: serializeRunRows(),
        successCalls: 0,
        totalCalls: 0,
      });
      setCurrentRunContext(activeRun);
    } catch {
      state.currentRunStatus = "running";
      state.currentRunUpdatedAt = runStartedAt;
      renderEntityState();
    }
  } else {
    state.currentRunStatus = "running";
    state.currentRunUpdatedAt = runStartedAt;
    renderEntityState();
  }

  const isMultiTurnRun = state.currentEvalType === EVAL_TYPE_MULTI_TURN;
  const histories = {};
  if (isMultiTurnRun) {
    for (const modelId of selectedModels) {
      histories[modelId] = buildInitialHistory(systemPrompt);
    }
  }

  let totalCalls = 0;
  let successCalls = 0;

  try {
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

      setStatus(`执行中：${getRowUnitLabel()} ${rowIndex + 1}/${state.rows.length}`, "warn");

      const roundResults = await Promise.all(
        selectedModels.map((modelId) =>
          requestByModel({
            apiKey,
            modelId,
            prompt,
            history: isMultiTurnRun ? histories[modelId] : buildInitialHistory(systemPrompt),
            temperature,
            provider,
            endpoint,
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

      if (scoreConfig.scoreMethod === SCORE_METHOD_EXACT) {
        applyExactScoresForRows([row]);
      }

      renderCaseTableBody();

      if (scoreConfig.scoreMethod === SCORE_METHOD_JUDGE) {
        await scoreRowsWithJudge([row], {
          apiKey,
          provider,
          endpoint,
          judgeModel: scoreConfig.judgeModel,
          judgePrompt: scoreConfig.judgePrompt,
          silent: true,
        });
      }

      renderCaseTableBody();
    }
  } catch (error) {
    const failedAt = Date.now();
    setBusy(false);
    if (activeRun?.id) {
      try {
        activeRun = await persistRunRecord({
          id: activeRun.id,
          experimentId,
          provider,
          endpoint,
          selectedModels,
          systemPrompt,
          temperature,
          outputTokenRatio,
          status: "failed",
          startedAt: runStartedAt,
          completedAt: failedAt,
          rows: serializeRunRows(),
          successCalls,
          totalCalls,
        });
        setCurrentRunContext(activeRun);
      } catch {
        state.currentRunStatus = "failed";
        state.currentRunCompletedAt = failedAt;
        state.currentRunUpdatedAt = failedAt;
        renderEntityState();
      }
    } else {
      state.currentRunStatus = "failed";
      state.currentRunCompletedAt = failedAt;
      state.currentRunUpdatedAt = failedAt;
      renderEntityState();
    }
    setStatus(`执行失败：${error instanceof Error ? error.message : String(error)}`, "err");
    return;
  }

  setBusy(false);

  const finalStatus = getRunCompletionStatus(successCalls, totalCalls);
  const completedAt = Date.now();
  let recordSaveError = null;
  let savedRun = null;
  try {
    savedRun = await persistRunRecord({
      id: activeRun?.id,
      experimentId,
      provider,
      endpoint,
      selectedModels,
      systemPrompt,
      temperature,
      outputTokenRatio,
      status: finalStatus,
      startedAt: runStartedAt,
      completedAt,
      rows: serializeRunRows(),
      successCalls,
      totalCalls,
    });
    setCurrentRunContext(savedRun);
  } catch (error) {
    recordSaveError = error;
  }

  if (recordSaveError) {
    state.currentRunStatus = finalStatus;
    state.currentRunCompletedAt = completedAt;
    state.currentRunUpdatedAt = completedAt;
    renderEntityState();
    const detail = recordSaveError instanceof Error ? recordSaveError.message : String(recordSaveError);
    const suffix = runRecordWarning ? `；${runRecordWarning}` : "";
    setStatus(`执行完成：成功 ${successCalls}/${totalCalls}，但运行记录保存失败（${detail}）${suffix}`, "warn");
    return;
  }

  const successType = successCalls === totalCalls ? "ok" : (successCalls > 0 ? "warn" : "err");
  if (runRecordWarning) {
    setStatus(`执行完成：成功 ${successCalls}/${totalCalls}。${runRecordWarning}`, "warn");
    return;
  }

  setStatus(`执行完成：成功 ${successCalls}/${totalCalls}`, successType);
}

function exportJson() {
  const provider = normalizeProvider(el.providerSelect.value);
  const payload = {
    exportedAt: new Date().toISOString(),
    config: {
      provider,
      baseUrl: provider === PROVIDER_CUSTOM ? sanitizeBaseUrl(el.baseUrlInput.value) : OPENROUTER_CHAT_ENDPOINT,
      temperature: parseTemperature(),
      outputTokenRatio: parseOutputTokenRatio(),
      systemPrompt: el.systemPromptInput.value,
      ...getCurrentScoreConfig(),
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

    state.currentSourceType = SOURCE_TYPE_PROMPT_FILE;
    syncExperimentModeState({ prefer: "source" });
    state.rows = prompts.map((prompt) => createRow(prompt));
    clearResults(true);
    renderCaseTable();
    saveCurrentConfig({ silent: true, source: "auto" });
    setStatus(`已导入 ${prompts.length} 条内容：${file.name}`, "ok");
  } catch (error) {
    setStatus(`读取文件失败：${error instanceof Error ? error.message : String(error)}`, "err");
  }
}

function addRow() {
  state.rows.push(createRow(""));
  renderCaseTableBody();
}

function clearRows() {
  state.currentSourceType = SOURCE_TYPE_MANUAL;
  syncExperimentModeState({ prefer: "source" });
  state.rows = [createRow("")];
  renderCaseTableBody();
  setStatus("已清空内容，仅保留一行", "ok");
}

function bindEvents() {
  el.runWorkflowBtn.addEventListener("click", runWorkflow);
  if (el.runJudgeBtn) {
    el.runJudgeBtn.addEventListener("click", () => {
      void runJudgeForCurrentResults({ silent: false, persist: true });
    });
  }
  el.clearResultsBtn.addEventListener("click", () => clearResults(false));
  el.exportBtn.addEventListener("click", exportJson);
  el.refreshModelsBtn.addEventListener("click", () => loadOfficialModels(true));
  el.addModelColBtn.addEventListener("click", addModelColumn);
  el.saveConfigBtn.addEventListener("click", () => saveCurrentConfig({ silent: false, source: "manual" }));
  el.clearHistoryBtn.addEventListener("click", clearConfigHistory);
  if (el.refreshScenarioSessionsBtn) {
    el.refreshScenarioSessionsBtn.addEventListener("click", () => {
      void loadScenarioSessions({ silent: false, force: true });
    });
  }
  el.importPromptBtn.addEventListener("click", () => el.promptFileInput.click());
  el.promptFileInput.addEventListener("change", handlePromptFileSelected);
  el.addRowBtn.addEventListener("click", addRow);
  el.clearRowsBtn.addEventListener("click", clearRows);

  el.rememberKeyInput.addEventListener("change", saveApiKeyPreference);
  el.apiKeyInput.addEventListener("blur", saveApiKeyPreference);
  if (el.globalScoreMethod) {
    el.globalScoreMethod.addEventListener("change", () => {
      const scoreMethod = normalizeScoreMethod(el.globalScoreMethod.value);
      if (scoreMethod === SCORE_METHOD_EXACT) {
        applyExactScoresForRows();
        renderCaseTableBody();
      } else {
        renderScoreControls();
      }
      if (state.currentExperimentId) {
        void saveCurrentConfig({ silent: true, source: "auto" });
      }
      setStatus(`已切换评分方式：${getScoreMethodLabel(scoreMethod)}`, "ok");
    });
  }
  if (el.judgeModelInput) {
    el.judgeModelInput.addEventListener("blur", () => {
      el.judgeModelInput.value = String(el.judgeModelInput.value || "").trim() || DEFAULT_JUDGE_MODEL;
      renderScoreControls();
      if (state.currentExperimentId) {
        void saveCurrentConfig({ silent: true, source: "auto" });
      }
    });
  }
  if (el.judgePromptInput) {
    el.judgePromptInput.addEventListener("blur", () => {
      el.judgePromptInput.value = String(el.judgePromptInput.value || "").trim() || DEFAULT_JUDGE_PROMPT;
      renderScoreControls();
      if (state.currentExperimentId) {
        void saveCurrentConfig({ silent: true, source: "auto" });
      }
    });
  }
  if (el.evalTypeSelect) {
    el.evalTypeSelect.addEventListener("change", () => {
      state.currentEvalType = normalizeEvalType(el.evalTypeSelect.value);
      syncExperimentModeState({ prefer: "eval" });
      clearResults(true);
      renderCaseTable();
      updateWorkbenchSummary();
      if (state.currentExperimentId) {
        void saveCurrentConfig({ silent: true, source: "auto" });
      }
      setStatus(`已切换评测类型：${getEvalTypeLabel(state.currentEvalType)}`, "ok");
    });
  }
  if (el.sourceTypeSelect) {
    el.sourceTypeSelect.addEventListener("change", () => {
      state.currentSourceType = normalizeSourceType(el.sourceTypeSelect.value);
      syncExperimentModeState({ prefer: "source" });
      clearResults(true);
      renderCaseTable();
      updateWorkbenchSummary();
      if (state.currentExperimentId) {
        void saveCurrentConfig({ silent: true, source: "auto" });
      }
      setStatus(`已切换输入来源：${getSourceTypeLabel(state.currentSourceType)}`, "ok");
    });
  }
  el.providerSelect.addEventListener("change", () => handleProviderChanged({ silent: false }));
  el.baseUrlInput.addEventListener("blur", () => {
    el.baseUrlInput.value = sanitizeBaseUrl(el.baseUrlInput.value);
    saveBaseUrlPreference();
  });
  el.systemPromptInput.addEventListener("input", renderCostEstimate);
  el.outputTokenRatioInput.addEventListener("input", renderCostEstimate);
  el.outputTokenRatioInput.addEventListener("blur", () => {
    el.outputTokenRatioInput.value = String(parseOutputTokenRatio());
    renderCostEstimate();
  });
}

async function init() {
  hydrateApiKeyPreference();
  hydrateProviderPreference();
  hydrateBaseUrlPreference();
  updateProviderUI();

  await hydratePlatformContext();
  state.configHistory = readLocalHistoryBackup(getHistoryNamespace());
  state.rows = [createRow("")];
  applyScoreConfigToForm({});

  bindEvents();
  renderModelColumns();
  renderCaseTable();
  renderHistoryList();
  updateWorkbenchSummary();

  await loadConfigHistoryFromServer({ silent: true });
  await restorePageContext();
  void loadOfficialModels(false);
}

void init();
