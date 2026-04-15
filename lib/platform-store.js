const fs = require("node:fs/promises");
const path = require("node:path");

const DATA_DIR_NAME = "data";
const PLATFORM_STATE_FILE = "platform-state.json";
const LEGACY_HISTORY_FILE = "config-history.json";
const LEGACY_RUNS_FILE = "eval-results.json";

const PLATFORM_STATE_VERSION = 2;
const MAX_EXPERIMENTS = 200;
const MAX_RUNS = 500;
const MAX_DATASETS = 200;
const MAX_SCORE_RECORDS = 5000;
const MAX_REPORTS = 500;
const MAX_MODELS = 20;
const MAX_ROWS = 500;

const DEFAULT_WORKSPACE_ID = "ws-default";
const DEFAULT_PROJECT_ID = "proj-default";
const LEGACY_IMPORTED_EXPERIMENT_ID = "exp-legacy-imported";
const STORAGE_DRIVER_LOCAL = "local-file";
const STORAGE_DRIVER_DATABASE = "database";

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toSafeString(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function toSafeText(value, max = 30000) {
  return String(value ?? "").slice(0, max);
}

function toSafeNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toSafeNonNegativeNumber(value) {
  const parsed = toSafeNumber(value);
  if (parsed == null || parsed < 0) return null;
  return parsed;
}

function toSafeNonNegativeInt(value) {
  const parsed = toSafeNonNegativeNumber(value);
  if (parsed == null) return null;
  return Math.round(parsed);
}

function toSafeVersion(value) {
  const parsed = toSafeNonNegativeInt(value);
  if (parsed == null || parsed < 1) return 1;
  return parsed;
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

function normalizeProvider(value) {
  return value === "custom" ? "custom" : "openrouter";
}

function normalizeEvalType(value, rows = []) {
  if (["single_turn", "multi_turn", "scenario"].includes(value)) return value;
  return "single_turn";
}

function inferLegacyEvalType(value, rows = []) {
  if (["single_turn", "multi_turn", "scenario"].includes(value)) return value;
  return rows.length > 1 ? "multi_turn" : "single_turn";
}

function normalizeExperimentStatus(value) {
  if (["draft", "active", "archived"].includes(value)) return value;
  return "draft";
}

function normalizeRunStatus(value) {
  if (["queued", "running", "partial_success", "completed", "failed", "cancelled"].includes(value)) {
    return value;
  }
  return "queued";
}

function normalizeTriggerSource(value) {
  if (["manual", "retry", "imported", "legacy_import"].includes(value)) return value;
  return "manual";
}

function normalizeSourceType(value) {
  if (["manual_prompt", "prompt_file", "dataset_import", "scenario_session"].includes(value)) {
    return value;
  }
  return "manual_prompt";
}

function normalizeScoreMethod(value) {
  if (["none", "exact", "judge"].includes(value)) return value;
  return "none";
}

function resolveRunStatus(item, rows = []) {
  if (["queued", "running", "partial_success", "completed", "failed", "cancelled"].includes(item?.status)) {
    return item.status;
  }
  if (toSafeNumber(item?.cancelledAt)) return "cancelled";
  if (toSafeNumber(item?.completedAt)) return "completed";
  if (toSafeNumber(item?.startedAt)) return "running";

  for (const row of rows) {
    for (const result of Object.values(row?.results || {})) {
      if (result && (result.ok || result.skipped || result.content)) {
        return "completed";
      }
    }
  }

  return "queued";
}

function isTerminalRunStatus(status) {
  return ["partial_success", "completed", "failed", "cancelled"].includes(status);
}

function shortText(text, max = 40) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function buildExperimentName(rows = []) {
  const firstPrompt = rows.find((row) => row && typeof row.prompt === "string" && row.prompt.trim());
  if (!firstPrompt) return "Untitled Experiment";
  const compact = firstPrompt.prompt.trim().replace(/\s+/g, " ");
  return shortText(compact, 32);
}

function normalizeExperimentRow(row) {
  if (!row || typeof row !== "object") return { prompt: "", scoreRef: "" };
  return {
    prompt: toSafeText(row.prompt, 20000),
    scoreRef: toSafeText(row.scoreRef, 5000),
  };
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const promptTokens = toSafeNonNegativeInt(usage.prompt_tokens);
  const completionTokens = toSafeNonNegativeInt(usage.completion_tokens);
  const totalTokens = toSafeNonNegativeInt(usage.total_tokens);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

function normalizeJudgeDetail(detail) {
  if (!detail || typeof detail !== "object") return null;
  return {
    accuracy: toSafeNumber(detail.accuracy),
    completeness: toSafeNumber(detail.completeness),
    fluency: toSafeNumber(detail.fluency),
    reason: toSafeString(detail.reason, 500),
  };
}

function normalizeRunResult(result, modelIdKey = "") {
  if (!result || typeof result !== "object") {
    return {
      modelId: toSafeString(modelIdKey, 200),
      ok: false,
      skipped: false,
      latencyMs: null,
      ttftMs: null,
      tps: null,
      usage: null,
      content: "",
      manualScore: null,
      ruleScore: null,
      judgeScore: null,
      judgeDetail: null,
    };
  }

  return {
    modelId: toSafeString(result.modelId || modelIdKey, 200),
    ok: !!result.ok,
    skipped: !!result.skipped,
    latencyMs: result.latencyMs == null ? null : toSafeNonNegativeInt(result.latencyMs),
    ttftMs: result.ttftMs == null ? null : toSafeNonNegativeNumber(result.ttftMs),
    tps: result.tps == null ? null : toSafeNonNegativeNumber(result.tps),
    usage: normalizeUsage(result.usage),
    content: toSafeText(result.content, 50000),
    manualScore: result.manualScore == null ? null : toSafeNonNegativeNumber(result.manualScore),
    ruleScore: result.ruleScore == null ? null : toSafeNumber(result.ruleScore),
    judgeScore: result.judgeScore == null ? null : toSafeNonNegativeNumber(result.judgeScore),
    judgeDetail: normalizeJudgeDetail(result.judgeDetail),
  };
}

function normalizeRunRow(row) {
  if (!row || typeof row !== "object") return null;
  const rawResults = row.results && typeof row.results === "object" ? row.results : {};
  const results = {};

  for (const [modelId, value] of Object.entries(rawResults)) {
    const normalized = normalizeRunResult(value, modelId);
    if (normalized.modelId) {
      results[normalized.modelId] = normalized;
    }
  }

  return {
    prompt: toSafeText(row.prompt, 20000),
    scoreRef: toSafeText(row.scoreRef, 5000),
    results,
  };
}

function computeRunSummary(config, rows) {
  const models = Array.isArray(config.models) ? config.models : [];
  let totalCalls = 0;
  let successCalls = 0;

  for (const row of rows) {
    for (const result of Object.values(row.results || {})) {
      if (result.skipped) continue;
      totalCalls += 1;
      if (result.ok) successCalls += 1;
    }
  }

  return {
    rowCount: rows.length,
    modelCount: models.length,
    successCalls,
    totalCalls,
  };
}

function normalizeDataset(item) {
  if (!item || typeof item !== "object") return null;
  const now = Date.now();
  const createdAt = toSafeNumber(item.createdAt) || now;
  const updatedAt = toSafeNumber(item.updatedAt) || createdAt;
  return {
    id: toSafeString(item.id, 120) || createId("ds"),
    workspaceId: toSafeString(item.workspaceId, 120) || DEFAULT_WORKSPACE_ID,
    projectId: toSafeString(item.projectId, 120) || DEFAULT_PROJECT_ID,
    version: toSafeVersion(item.version),
    name: toSafeString(item.name, 120) || "Untitled Dataset",
    taskType: toSafeString(item.taskType, 40) || "generic",
    description: toSafeText(item.description, 4000),
    latestVersionId: toSafeString(item.latestVersionId, 120),
    createdAt,
    updatedAt,
  };
}

function normalizeScoreRecord(item) {
  if (!item || typeof item !== "object") return null;
  const now = Date.now();
  const createdAt = toSafeNumber(item.createdAt) || now;
  const updatedAt = toSafeNumber(item.updatedAt) || createdAt;
  return {
    id: toSafeString(item.id, 120) || createId("score"),
    workspaceId: toSafeString(item.workspaceId, 120) || DEFAULT_WORKSPACE_ID,
    projectId: toSafeString(item.projectId, 120) || DEFAULT_PROJECT_ID,
    version: toSafeVersion(item.version),
    experimentId: toSafeString(item.experimentId, 120),
    runId: toSafeString(item.runId, 120),
    caseKey: toSafeString(item.caseKey, 200),
    modelId: toSafeString(item.modelId, 200),
    scoreType: toSafeString(item.scoreType, 40) || "unknown",
    scoreValue: item.scoreValue == null ? null : toSafeNumber(item.scoreValue),
    detail: item.detail && typeof item.detail === "object" ? item.detail : null,
    createdAt,
    updatedAt,
  };
}

function normalizeReport(item) {
  if (!item || typeof item !== "object") return null;
  const now = Date.now();
  const createdAt = toSafeNumber(item.createdAt) || now;
  const updatedAt = toSafeNumber(item.updatedAt) || createdAt;
  return {
    id: toSafeString(item.id, 120) || createId("report"),
    workspaceId: toSafeString(item.workspaceId, 120) || DEFAULT_WORKSPACE_ID,
    projectId: toSafeString(item.projectId, 120) || DEFAULT_PROJECT_ID,
    version: toSafeVersion(item.version),
    experimentId: toSafeString(item.experimentId, 120),
    runId: toSafeString(item.runId, 120),
    title: toSafeString(item.title, 160) || "Untitled Report",
    status: toSafeString(item.status, 40) || "draft",
    summaryMd: toSafeText(item.summaryMd, 50000),
    visibility: toSafeString(item.visibility, 40) || "private",
    createdAt,
    updatedAt,
  };
}

function normalizeExperiment(item) {
  if (!item || typeof item !== "object") return null;
  const now = Date.now();
  const rawConfig = item.config && typeof item.config === "object" ? item.config : {};
  const rows = Array.isArray(rawConfig.rows)
    ? rawConfig.rows.map(normalizeExperimentRow).slice(0, MAX_ROWS)
    : [];
  const selectedModels = Array.isArray(rawConfig.selectedModels)
    ? rawConfig.selectedModels.map((model) => toSafeString(model, 200)).filter(Boolean).slice(0, MAX_MODELS)
    : [];
  const createdAt = toSafeNumber(item.createdAt) || toSafeNumber(item.savedAt) || now;
  const updatedAt = toSafeNumber(item.updatedAt) || toSafeNumber(item.savedAt) || createdAt;
  const lastOpenedAt = toSafeNumber(item.lastOpenedAt) || updatedAt;
  const provider = normalizeProvider(rawConfig.provider || item.provider);

  return {
    id: toSafeString(item.id, 120) || createId("exp"),
    workspaceId: toSafeString(item.workspaceId, 120) || DEFAULT_WORKSPACE_ID,
    projectId: toSafeString(item.projectId, 120) || DEFAULT_PROJECT_ID,
    version: toSafeVersion(item.version),
    name: toSafeString(item.name || item.title, 120) || buildExperimentName(rows),
    evalType: normalizeEvalType(item.evalType || rawConfig.evalType, rows),
    status: normalizeExperimentStatus(item.status),
    sourceType: normalizeSourceType(item.sourceType || rawConfig.sourceType),
    datasetId: toSafeString(item.datasetId || rawConfig.datasetId, 120),
    datasetVersionId: toSafeString(item.datasetVersionId || rawConfig.datasetVersionId, 120),
    createdAt,
    updatedAt,
    lastOpenedAt,
    config: {
      provider,
      baseUrl: provider === "custom" ? toSafeString(rawConfig.baseUrl || item.baseUrl, 500) : "",
      temperature: clampTemperature(Number(rawConfig.temperature ?? item.temperature)),
      outputTokenRatio: clampOutputTokenRatio(Number(rawConfig.outputTokenRatio ?? item.outputTokenRatio)),
      systemPrompt: toSafeText(rawConfig.systemPrompt || item.systemPrompt, 20000),
      scoreMethod: normalizeScoreMethod(rawConfig.scoreMethod || item.scoreMethod),
      judgeModel: toSafeString(rawConfig.judgeModel || rawConfig.judgeModelId || item.judgeModel || item.judgeModelId, 200),
      judgePrompt: toSafeText(rawConfig.judgePrompt || rawConfig.judgePromptTemplate || item.judgePrompt || item.judgePromptTemplate, 12000),
      selectedModels,
      rows,
    },
  };
}

function normalizeRun(item) {
  if (!item || typeof item !== "object") return null;
  const now = Date.now();
  const rawConfig = item.config && typeof item.config === "object" ? item.config : {};
  const rows = Array.isArray(item.rows)
    ? item.rows.map(normalizeRunRow).filter(Boolean).slice(0, MAX_ROWS)
    : [];
  const models = Array.isArray(rawConfig.models)
    ? rawConfig.models.map((model) => toSafeString(model, 200)).filter(Boolean).slice(0, MAX_MODELS)
    : [];
  const status = resolveRunStatus(item, rows);
  const createdAt = toSafeNumber(item.createdAt) || toSafeNumber(item.savedAt) || now;
  const updatedAt = toSafeNumber(item.updatedAt) || toSafeNumber(item.savedAt) || createdAt;
  const completedAt = isTerminalRunStatus(status)
    ? (toSafeNumber(item.completedAt) || (toSafeNumber(item.savedAt) && status !== "queued" ? toSafeNumber(item.savedAt) : null) || updatedAt)
    : null;
  const provider = normalizeProvider(rawConfig.provider);
  const summary = computeRunSummary({ models }, rows);

  return {
    id: toSafeString(item.id, 120) || createId("run"),
    workspaceId: toSafeString(item.workspaceId, 120) || DEFAULT_WORKSPACE_ID,
    projectId: toSafeString(item.projectId, 120) || DEFAULT_PROJECT_ID,
    version: toSafeVersion(item.version),
    experimentId: toSafeString(item.experimentId, 120),
    evalType: normalizeEvalType(item.evalType || rawConfig.evalType, rows),
    sourceType: normalizeSourceType(item.sourceType || rawConfig.sourceType),
    datasetId: toSafeString(item.datasetId || rawConfig.datasetId, 120),
    datasetVersionId: toSafeString(item.datasetVersionId || rawConfig.datasetVersionId, 120),
    name: toSafeString(item.name, 120) || "Run",
    status,
    triggerSource: normalizeTriggerSource(item.triggerSource),
    createdAt,
    updatedAt,
    startedAt: toSafeNumber(item.startedAt) || createdAt,
    completedAt,
    config: {
      provider,
      baseUrl: provider === "custom" ? toSafeString(rawConfig.baseUrl, 500) : "",
      models,
      systemPrompt: toSafeText(rawConfig.systemPrompt, 20000),
      temperature: clampTemperature(Number(rawConfig.temperature)),
      outputTokenRatio: clampOutputTokenRatio(Number(rawConfig.outputTokenRatio)),
      scoreMethod: normalizeScoreMethod(rawConfig.scoreMethod),
      judgeModel: toSafeString(rawConfig.judgeModel || rawConfig.judgeModelId, 200),
      judgePrompt: toSafeText(rawConfig.judgePrompt || rawConfig.judgePromptTemplate, 12000),
    },
    rows,
    summary: {
      rowCount: toSafeNonNegativeInt(item.summary?.rowCount) ?? summary.rowCount,
      modelCount: toSafeNonNegativeInt(item.summary?.modelCount) ?? summary.modelCount,
      successCalls: toSafeNonNegativeInt(item.summary?.successCalls) ?? summary.successCalls,
      totalCalls: toSafeNonNegativeInt(item.summary?.totalCalls) ?? summary.totalCalls,
    },
  };
}

function buildExperimentSignature(config = {}) {
  const models = Array.isArray(config.selectedModels) ? config.selectedModels : [];
  return JSON.stringify({
    provider: normalizeProvider(config.provider),
    baseUrl: toSafeString(config.baseUrl, 500),
    temperature: clampTemperature(Number(config.temperature)),
    systemPrompt: toSafeText(config.systemPrompt, 20000),
    scoreMethod: normalizeScoreMethod(config.scoreMethod),
    judgeModel: toSafeString(config.judgeModel || config.judgeModelId, 200),
    selectedModels: models,
  });
}

function buildRunSignature(config = {}) {
  const models = Array.isArray(config.models) ? config.models : [];
  return JSON.stringify({
    provider: normalizeProvider(config.provider),
    baseUrl: toSafeString(config.baseUrl, 500),
    temperature: clampTemperature(Number(config.temperature)),
    systemPrompt: toSafeText(config.systemPrompt, 20000),
    scoreMethod: normalizeScoreMethod(config.scoreMethod),
    judgeModel: toSafeString(config.judgeModel || config.judgeModelId, 200),
    selectedModels: models,
  });
}

function createDefaultState() {
  const now = Date.now();
  return {
    version: PLATFORM_STATE_VERSION,
    migratedAt: null,
    workspaces: [
      {
        id: DEFAULT_WORKSPACE_ID,
        name: "Default Workspace",
        status: "active",
        version: 1,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    projects: [
      {
        id: DEFAULT_PROJECT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        name: "Default Project",
        status: "active",
        version: 1,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    datasets: [],
    experiments: [],
    runs: [],
    scoreRecords: [],
    reports: [],
  };
}

function repairState(state) {
  const base = createDefaultState();
  const workspaces = Array.isArray(state?.workspaces) ? state.workspaces : [];
  const projects = Array.isArray(state?.projects) ? state.projects : [];
  const datasets = Array.isArray(state?.datasets) ? state.datasets : [];
  const experiments = Array.isArray(state?.experiments) ? state.experiments : [];
  const runs = Array.isArray(state?.runs) ? state.runs : [];
  const scoreRecords = Array.isArray(state?.scoreRecords) ? state.scoreRecords : [];
  const reports = Array.isArray(state?.reports) ? state.reports : [];

  const normalizedWorkspaces = workspaces.length
    ? workspaces.map((workspace) => ({
        id: toSafeString(workspace.id, 120) || DEFAULT_WORKSPACE_ID,
        name: toSafeString(workspace.name, 120) || "Default Workspace",
        status: toSafeString(workspace.status, 40) || "active",
        version: toSafeVersion(workspace.version),
        isDefault: !!workspace.isDefault,
        createdAt: toSafeNumber(workspace.createdAt) || Date.now(),
        updatedAt: toSafeNumber(workspace.updatedAt) || Date.now(),
      }))
    : base.workspaces;

  const normalizedProjects = projects.length
    ? projects.map((project) => ({
        id: toSafeString(project.id, 120) || DEFAULT_PROJECT_ID,
        workspaceId: toSafeString(project.workspaceId, 120) || DEFAULT_WORKSPACE_ID,
        name: toSafeString(project.name, 120) || "Default Project",
        status: toSafeString(project.status, 40) || "active",
        version: toSafeVersion(project.version),
        isDefault: !!project.isDefault,
        createdAt: toSafeNumber(project.createdAt) || Date.now(),
        updatedAt: toSafeNumber(project.updatedAt) || Date.now(),
      }))
    : base.projects;

  const workspaceExists = normalizedWorkspaces.some((workspace) => workspace.id === DEFAULT_WORKSPACE_ID);
  if (!workspaceExists) {
    normalizedWorkspaces.unshift(base.workspaces[0]);
  }

  const projectExists = normalizedProjects.some((project) => project.id === DEFAULT_PROJECT_ID);
  if (!projectExists) {
    normalizedProjects.unshift(base.projects[0]);
  }

  const normalizedExperiments = experiments
    .map(normalizeExperiment)
    .filter(Boolean)
    .slice(0, MAX_EXPERIMENTS);
  const normalizedDatasets = datasets
    .map(normalizeDataset)
    .filter(Boolean)
    .slice(0, MAX_DATASETS);
  const normalizedRuns = runs
    .map(normalizeRun)
    .filter(Boolean)
    .slice(0, MAX_RUNS);
  const normalizedScoreRecords = scoreRecords
    .map(normalizeScoreRecord)
    .filter(Boolean)
    .slice(0, MAX_SCORE_RECORDS);
  const normalizedReports = reports
    .map(normalizeReport)
    .filter(Boolean)
    .slice(0, MAX_REPORTS);

  return {
    version: PLATFORM_STATE_VERSION,
    migratedAt: toSafeNumber(state?.migratedAt),
    workspaces: normalizedWorkspaces,
    projects: normalizedProjects,
    datasets: normalizedDatasets,
    experiments: normalizedExperiments,
    runs: normalizedRuns,
    scoreRecords: normalizedScoreRecords,
    reports: normalizedReports,
  };
}

function normalizeStorageDriver(value) {
  return value === STORAGE_DRIVER_DATABASE ? STORAGE_DRIVER_DATABASE : STORAGE_DRIVER_LOCAL;
}

function createStorageMeta({ requestedDriver, activeDriver, fallbackReason = null, provider = null }) {
  return {
    requestedDriver,
    activeDriver,
    fallbackReason,
    provider,
  };
}

function createDatabaseStorageAdapter(rootDir) {
  const injected = globalThis.__MODEL_EVAL_DATABASE_ADAPTER__;
  if (!injected || typeof injected.readState !== "function" || typeof injected.writeState !== "function") {
    return null;
  }

  return {
    meta: createStorageMeta({
      requestedDriver: STORAGE_DRIVER_DATABASE,
      activeDriver: STORAGE_DRIVER_DATABASE,
      provider: typeof injected.name === "string" && injected.name ? injected.name : "injected-adapter",
    }),
    async readState() {
      const raw = await injected.readState({ rootDir, defaultState: createDefaultState() });
      return repairState(raw);
    },
    async writeState(state) {
      await injected.writeState({ rootDir, state: repairState(state) });
    },
  };
}

function createLocalFileStorageAdapter(rootDir, options = {}) {
  const requestedDriver = normalizeStorageDriver(options.requestedDriver);
  const fallbackReason = options.fallbackReason || null;
  return {
    meta: createStorageMeta({
      requestedDriver,
      activeDriver: STORAGE_DRIVER_LOCAL,
      fallbackReason,
      provider: "platform-state-json",
    }),
    async readState() {
      const filePath = await ensureStateFile(rootDir);
      const raw = await readJsonFile(filePath, null);
      return repairState(raw);
    },
    async writeState(state) {
      const filePath = await ensureStateFile(rootDir);
      await writeJsonFile(filePath, repairState(state));
    },
  };
}

function resolveStorageAdapter(rootDir) {
  const requestedDriver = normalizeStorageDriver(process.env.MODEL_EVAL_STORAGE_DRIVER);
  if (requestedDriver === STORAGE_DRIVER_DATABASE) {
    const databaseAdapter = createDatabaseStorageAdapter(rootDir);
    if (databaseAdapter) {
      return databaseAdapter;
    }

    return createLocalFileStorageAdapter(rootDir, {
      requestedDriver,
      fallbackReason: "database adapter not configured",
    });
  }

  return createLocalFileStorageAdapter(rootDir, { requestedDriver });
}

function getStorageMeta(rootDir) {
  return resolveStorageAdapter(rootDir).meta;
}

function getDataPaths(rootDir) {
  const dataDir = path.join(rootDir, DATA_DIR_NAME);
  return {
    dataDir,
    platformStateFile: path.join(dataDir, PLATFORM_STATE_FILE),
    legacyHistoryFile: path.join(dataDir, LEGACY_HISTORY_FILE),
    legacyRunsFile: path.join(dataDir, LEGACY_RUNS_FILE),
  };
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

async function writeJsonFile(filePath, payload) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpFile = `${filePath}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tmpFile, filePath);
}

function legacyHistoryItemsToExperiments(legacyDb) {
  if (!legacyDb || typeof legacyDb !== "object") return [];
  const items = [];
  for (const value of Object.values(legacyDb)) {
    if (!Array.isArray(value)) continue;
    items.push(...value);
  }

  const experiments = items
    .map((item) => normalizeExperiment({
      id: item.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId: DEFAULT_PROJECT_ID,
      name: item.title,
      status: "draft",
      evalType: inferLegacyEvalType(item.evalType, item.rows),
      sourceType: "manual_prompt",
      createdAt: item.savedAt,
      updatedAt: item.savedAt,
      lastOpenedAt: item.savedAt,
      config: {
        provider: item.provider,
        baseUrl: item.baseUrl,
        temperature: item.temperature,
        outputTokenRatio: item.outputTokenRatio,
        systemPrompt: item.systemPrompt,
        scoreMethod: item.scoreMethod,
        judgeModel: item.judgeModel || item.judgeModelId,
        judgePrompt: item.judgePrompt || item.judgePromptTemplate,
        selectedModels: item.selectedModels,
        rows: item.rows,
      },
    }))
    .filter(Boolean);

  const unique = new Map();
  for (const experiment of experiments) {
    unique.set(experiment.id, experiment);
  }
  return Array.from(unique.values()).slice(0, MAX_EXPERIMENTS);
}

function ensureLegacyImportedExperiment(experiments, now = Date.now()) {
  const existing = experiments.find((experiment) => experiment.id === LEGACY_IMPORTED_EXPERIMENT_ID);
  if (existing) return existing.id;

  experiments.push(normalizeExperiment({
    id: LEGACY_IMPORTED_EXPERIMENT_ID,
    workspaceId: DEFAULT_WORKSPACE_ID,
    projectId: DEFAULT_PROJECT_ID,
    name: "Legacy Imported Runs",
    status: "archived",
    evalType: "single_turn",
    sourceType: "manual_prompt",
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    config: {
      provider: "openrouter",
      baseUrl: "",
      temperature: 0,
      outputTokenRatio: 1,
      systemPrompt: "",
      selectedModels: [],
      rows: [],
    },
  }));

  return LEGACY_IMPORTED_EXPERIMENT_ID;
}

function legacyRunsToRuns(legacyRuns, experiments) {
  const signatureMap = new Map();
  for (const experiment of experiments) {
    signatureMap.set(buildExperimentSignature(experiment.config), experiment.id);
  }

  const runs = [];
  for (const item of Array.isArray(legacyRuns) ? legacyRuns : []) {
    const normalized = normalizeRun({
      id: item.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      projectId: DEFAULT_PROJECT_ID,
      experimentId: "",
      evalType: inferLegacyEvalType(item.evalType, item.rows),
      sourceType: "manual_prompt",
      name: item.name,
      status: item.status || "completed",
      triggerSource: "legacy_import",
      createdAt: item.savedAt,
      updatedAt: item.savedAt,
      startedAt: item.savedAt,
      completedAt: item.savedAt,
      config: {
        provider: item.config?.provider,
        baseUrl: item.config?.baseUrl,
        models: item.config?.models,
        systemPrompt: item.config?.systemPrompt,
        temperature: item.config?.temperature,
        outputTokenRatio: item.config?.outputTokenRatio,
        scoreMethod: item.config?.scoreMethod,
        judgeModel: item.config?.judgeModel || item.config?.judgeModelId,
        judgePrompt: item.config?.judgePrompt || item.config?.judgePromptTemplate,
      },
      rows: item.rows,
      summary: item.summary,
    });
    if (!normalized) continue;

    const signature = buildRunSignature(normalized.config);
    normalized.experimentId = signatureMap.get(signature) || ensureLegacyImportedExperiment(experiments, normalized.createdAt);
    runs.push(normalized);
  }

  return runs.slice(0, MAX_RUNS);
}

async function buildInitialState(rootDir) {
  const paths = getDataPaths(rootDir);
  const base = createDefaultState();
  const legacyHistoryDb = await readJsonFile(paths.legacyHistoryFile, {});
  const legacyRuns = await readJsonFile(paths.legacyRunsFile, []);

  const experiments = legacyHistoryItemsToExperiments(legacyHistoryDb);
  const runs = legacyRunsToRuns(legacyRuns, experiments);

  return repairState({
    ...base,
    migratedAt: Date.now(),
    experiments,
    runs,
  });
}

async function ensureStateFile(rootDir) {
  const paths = getDataPaths(rootDir);
  await fs.mkdir(paths.dataDir, { recursive: true });

  try {
    await fs.access(paths.platformStateFile);
  } catch {
    const initialState = await buildInitialState(rootDir);
    await writeJsonFile(paths.platformStateFile, initialState);
  }

  return paths.platformStateFile;
}

async function readState(rootDir) {
  const adapter = resolveStorageAdapter(rootDir);
  const state = await adapter.readState();
  syncAllRunArtifacts(state, { preserveVersion: true });
  return { state, storage: adapter.meta };
}

async function writeState(rootDir, state) {
  const adapter = resolveStorageAdapter(rootDir);
  await adapter.writeState(state);
}

function listSortedExperiments(state, projectId) {
  return state.experiments
    .filter((experiment) => !projectId || experiment.projectId === projectId)
    .sort((a, b) => Math.max(b.updatedAt, b.lastOpenedAt) - Math.max(a.updatedAt, a.lastOpenedAt));
}

function listSortedRuns(state, projectId, experimentId = "") {
  return state.runs
    .filter((run) => (!projectId || run.projectId === projectId) && (!experimentId || run.experimentId === experimentId))
    .sort((a, b) => Math.max(b.updatedAt || 0, b.completedAt || 0, b.createdAt || 0) - Math.max(a.updatedAt || 0, a.completedAt || 0, a.createdAt || 0));
}

function listSortedScoreRecords(state, options = {}) {
  const { projectId = DEFAULT_PROJECT_ID, experimentId = "", runId = "", scoreType = "" } = options;
  return state.scoreRecords
    .filter((record) => (
      (!projectId || record.projectId === projectId)
      && (!experimentId || record.experimentId === experimentId)
      && (!runId || record.runId === runId)
      && (!scoreType || record.scoreType === scoreType)
    ))
    .sort((a, b) => Math.max(b.updatedAt || 0, b.createdAt || 0) - Math.max(a.updatedAt || 0, a.createdAt || 0));
}

function listSortedReports(state, options = {}) {
  const { projectId = DEFAULT_PROJECT_ID, experimentId = "", runId = "", status = "" } = options;
  return state.reports
    .filter((report) => (
      (!projectId || report.projectId === projectId)
      && (!experimentId || report.experimentId === experimentId)
      && (!runId || report.runId === runId)
      && (!status || report.status === status)
    ))
    .sort((a, b) => Math.max(b.updatedAt || 0, b.createdAt || 0) - Math.max(a.updatedAt || 0, a.createdAt || 0));
}

function toExperimentListItem(experiment) {
  return {
    id: experiment.id,
    workspaceId: experiment.workspaceId,
    projectId: experiment.projectId,
    version: experiment.version,
    title: experiment.name,
    name: experiment.name,
    evalType: experiment.evalType,
    status: experiment.status,
    sourceType: experiment.sourceType,
    datasetId: experiment.datasetId,
    datasetVersionId: experiment.datasetVersionId,
    savedAt: experiment.updatedAt,
    updatedAt: experiment.updatedAt,
    lastOpenedAt: experiment.lastOpenedAt,
    temperature: experiment.config.temperature,
    outputTokenRatio: experiment.config.outputTokenRatio,
    provider: experiment.config.provider,
    baseUrl: experiment.config.baseUrl,
    systemPrompt: experiment.config.systemPrompt,
    scoreMethod: experiment.config.scoreMethod,
    judgeModel: experiment.config.judgeModel,
    judgePrompt: experiment.config.judgePrompt,
    selectedModels: experiment.config.selectedModels,
    rows: experiment.config.rows,
  };
}

function toRunListItem(run) {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    version: run.version,
    experimentId: run.experimentId,
    evalType: run.evalType,
    sourceType: run.sourceType,
    datasetId: run.datasetId,
    datasetVersionId: run.datasetVersionId,
    name: run.name,
    status: run.status,
    triggerSource: run.triggerSource,
    savedAt: run.completedAt || run.updatedAt || run.createdAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    config: run.config,
    summary: run.summary,
    rows: run.rows,
  };
}

function toScoreRecordListItem(record) {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    version: record.version,
    experimentId: record.experimentId,
    runId: record.runId,
    caseKey: record.caseKey,
    modelId: record.modelId,
    scoreType: record.scoreType,
    scoreValue: record.scoreValue,
    detail: record.detail,
    savedAt: record.updatedAt || record.createdAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toReportListItem(report) {
  return {
    id: report.id,
    workspaceId: report.workspaceId,
    projectId: report.projectId,
    version: report.version,
    experimentId: report.experimentId,
    runId: report.runId,
    title: report.title,
    status: report.status,
    summaryMd: report.summaryMd,
    visibility: report.visibility,
    savedAt: report.updatedAt || report.createdAt,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

function mergeExperimentPayload(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    config: {
      ...(existing.config || {}),
      ...(incoming.config || {}),
    },
  };
}

function mergeRunPayload(existing, incoming) {
  if (!existing) return incoming;

  const merged = {
    ...existing,
    ...incoming,
    config: {
      ...(existing.config || {}),
      ...(incoming.config || {}),
    },
    summary: {
      ...(existing.summary || {}),
      ...(incoming.summary || {}),
    },
  };

  if (!Object.prototype.hasOwnProperty.call(incoming, "rows")) {
    merged.rows = existing.rows;
  }

  return merged;
}

function mergeScoreRecordPayload(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    detail: incoming && Object.prototype.hasOwnProperty.call(incoming, "detail") ? incoming.detail : existing.detail,
  };
}

function mergeReportPayload(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    summaryMd: incoming && Object.prototype.hasOwnProperty.call(incoming, "summaryMd") ? incoming.summaryMd : existing.summaryMd,
  };
}

function createStableIdSegment(value, fallback = "item") {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || fallback;
}

function buildDerivedReportId(runId) {
  return `report-run-${createStableIdSegment(runId, "run")}`;
}

function buildDerivedScoreRecordPrefix(runId) {
  return `score-run-${createStableIdSegment(runId, "run")}-`;
}

function buildDerivedScoreRecordId({ runId, rowIndex, modelId, scoreType }) {
  return `${buildDerivedScoreRecordPrefix(runId)}${rowIndex + 1}-${createStableIdSegment(modelId, "model")}-${createStableIdSegment(scoreType, "score")}`;
}

function finalizeCollectionItem(existing, normalized, options = {}) {
  if (!normalized) return null;

  const now = toSafeNumber(options.now) || Date.now();
  const preserveVersion = !!options.preserveVersion;
  if (existing) {
    return {
      ...existing,
      ...normalized,
      createdAt: existing.createdAt || normalized.createdAt || now,
      updatedAt: preserveVersion ? (existing.updatedAt || normalized.updatedAt || now) : now,
      version: preserveVersion ? toSafeVersion(existing.version) : toSafeVersion(normalized.version || (existing.version + 1)),
    };
  }

  return {
    ...normalized,
    createdAt: toSafeNumber(normalized.createdAt) || now,
    updatedAt: preserveVersion ? (toSafeNumber(normalized.updatedAt) || now) : now,
    version: toSafeVersion(normalized.version),
  };
}

function collectRunScoreStats(run) {
  const stats = new Map();

  for (const row of run.rows || []) {
    for (const [modelId, result] of Object.entries(row.results || {})) {
      if (!result) continue;
      const current = stats.get(modelId) || {
        modelId,
        manualCount: 0,
        manualTotal: 0,
        ruleCount: 0,
        ruleTotal: 0,
        judgeCount: 0,
        judgeTotal: 0,
      };

      if (result.manualScore != null) {
        current.manualCount += 1;
        current.manualTotal += result.manualScore;
      }
      if (result.ruleScore != null) {
        current.ruleCount += 1;
        current.ruleTotal += result.ruleScore;
      }
      if (result.judgeScore != null) {
        current.judgeCount += 1;
        current.judgeTotal += result.judgeScore;
      }

      stats.set(modelId, current);
    }
  }

  return Array.from(stats.values()).map((item) => ({
    modelId: item.modelId,
    manualCount: item.manualCount,
    manualAvg: item.manualCount ? Number((item.manualTotal / item.manualCount).toFixed(3)) : null,
    ruleCount: item.ruleCount,
    ruleAvg: item.ruleCount ? Number((item.ruleTotal / item.ruleCount).toFixed(3)) : null,
    judgeCount: item.judgeCount,
    judgeAvg: item.judgeCount ? Number((item.judgeTotal / item.judgeCount).toFixed(3)) : null,
  }));
}

function buildDerivedScoreRecordsForRun(run) {
  const createdAt = run.completedAt || run.updatedAt || run.createdAt || Date.now();
  const records = [];

  for (const [rowIndex, row] of (run.rows || []).entries()) {
    const caseKey = row.scoreRef || `row-${rowIndex + 1}`;
    const promptPreview = shortText(String(row.prompt || "").replace(/\s+/g, " "), 160);

    for (const [modelId, result] of Object.entries(row.results || {})) {
      if (!result) continue;

      const baseDetail = {
        scoreRef: row.scoreRef || "",
        promptPreview,
        ok: !!result.ok,
        latencyMs: result.latencyMs,
      };

      if (result.manualScore != null) {
        records.push(normalizeScoreRecord({
          id: buildDerivedScoreRecordId({ runId: run.id, rowIndex, modelId, scoreType: "manual" }),
          workspaceId: run.workspaceId,
          projectId: run.projectId,
          experimentId: run.experimentId,
          runId: run.id,
          caseKey,
          modelId,
          scoreType: "manual",
          scoreValue: result.manualScore,
          detail: baseDetail,
          createdAt,
          updatedAt: createdAt,
        }));
      }

      if (result.ruleScore != null) {
        records.push(normalizeScoreRecord({
          id: buildDerivedScoreRecordId({ runId: run.id, rowIndex, modelId, scoreType: "rule" }),
          workspaceId: run.workspaceId,
          projectId: run.projectId,
          experimentId: run.experimentId,
          runId: run.id,
          caseKey,
          modelId,
          scoreType: "rule",
          scoreValue: result.ruleScore,
          detail: baseDetail,
          createdAt,
          updatedAt: createdAt,
        }));
      }

      if (result.judgeScore != null) {
        records.push(normalizeScoreRecord({
          id: buildDerivedScoreRecordId({ runId: run.id, rowIndex, modelId, scoreType: "judge" }),
          workspaceId: run.workspaceId,
          projectId: run.projectId,
          experimentId: run.experimentId,
          runId: run.id,
          caseKey,
          modelId,
          scoreType: "judge",
          scoreValue: result.judgeScore,
          detail: {
            ...baseDetail,
            judgeDetail: result.judgeDetail || null,
          },
          createdAt,
          updatedAt: createdAt,
        }));
      }
    }
  }

  return records.filter(Boolean);
}

function shouldDeriveReportForRun(run) {
  if (!run) return false;
  if (isTerminalRunStatus(run.status)) return true;
  return (run.rows || []).some((row) => Object.values(row.results || {}).some((result) => result && (result.ok || result.skipped || result.content)));
}

function buildDerivedReportFromRun(run, scoreRecords = []) {
  if (!shouldDeriveReportForRun(run)) return null;

  const scoreStats = collectRunScoreStats(run);
  const modelLine = (run.config?.models || []).length ? run.config.models.join(", ") : "(none)";
  const headerLines = [
    `# ${run.name || "Run Summary"}`,
    "",
    `- Run ID: ${run.id}`,
    `- Experiment ID: ${run.experimentId || "(none)"}`,
    `- Status: ${run.status}`,
    `- Eval Type: ${run.evalType}`,
    `- Source Type: ${run.sourceType}`,
    `- Models: ${modelLine}`,
    `- Rows: ${run.summary?.rowCount ?? 0}`,
    `- Success Calls: ${run.summary?.successCalls ?? 0}/${run.summary?.totalCalls ?? 0}`,
    `- Score Records: ${scoreRecords.length}`,
  ];

  if (scoreStats.length) {
    headerLines.push("", "## Score Overview");
    for (const item of scoreStats) {
      const parts = [];
      if (item.manualAvg != null) parts.push(`manual ${item.manualAvg} (${item.manualCount})`);
      if (item.ruleAvg != null) parts.push(`rule ${item.ruleAvg} (${item.ruleCount})`);
      if (item.judgeAvg != null) parts.push(`judge ${item.judgeAvg} (${item.judgeCount})`);
      headerLines.push(`- ${item.modelId}: ${parts.join(" · ")}`);
    }
  }

  const createdAt = run.completedAt || run.updatedAt || run.createdAt || Date.now();
  return normalizeReport({
    id: buildDerivedReportId(run.id),
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    experimentId: run.experimentId,
    runId: run.id,
    title: `${run.name || "Run"} · Summary`,
    status: isTerminalRunStatus(run.status) ? "ready" : "draft",
    summaryMd: headerLines.join("\n"),
    visibility: "private",
    createdAt,
    updatedAt: createdAt,
  });
}

function syncRunArtifacts(state, run, options = {}) {
  if (!run) return;

  const preserveVersion = !!options.preserveVersion;
  const reportId = buildDerivedReportId(run.id);
  const reportIndex = state.reports.findIndex((report) => report.id === reportId);
  const existingReport = reportIndex >= 0 ? state.reports[reportIndex] : null;

  const scorePrefix = buildDerivedScoreRecordPrefix(run.id);
  const existingDerivedScores = new Map(
    state.scoreRecords
      .filter((record) => String(record.id || "").startsWith(scorePrefix))
      .map((record) => [record.id, record]),
  );

  const derivedScoreRecords = buildDerivedScoreRecordsForRun(run).map((record) => (
    finalizeCollectionItem(existingDerivedScores.get(record.id), record, {
      now: run.updatedAt || run.completedAt || run.createdAt || Date.now(),
      preserveVersion,
    })
  ));

  state.scoreRecords = state.scoreRecords
    .filter((record) => !String(record.id || "").startsWith(scorePrefix));
  state.scoreRecords.unshift(...derivedScoreRecords.filter(Boolean));
  state.scoreRecords = listSortedScoreRecords(state, { projectId: "" }).slice(0, MAX_SCORE_RECORDS);

  const derivedReport = buildDerivedReportFromRun(run, derivedScoreRecords);
  if (reportIndex >= 0) {
    state.reports.splice(reportIndex, 1);
  }
  if (derivedReport) {
    state.reports.unshift(finalizeCollectionItem(existingReport, derivedReport, {
      now: run.updatedAt || run.completedAt || run.createdAt || Date.now(),
      preserveVersion,
    }));
  }
  state.reports = listSortedReports(state, { projectId: "" }).slice(0, MAX_REPORTS);
}

function syncAllRunArtifacts(state, options = {}) {
  for (const run of state.runs || []) {
    syncRunArtifacts(state, run, options);
  }
  return state;
}

async function getBootstrap(rootDir) {
  const { state, storage } = await readState(rootDir);
  const workspace = state.workspaces.find((item) => item.id === DEFAULT_WORKSPACE_ID) || state.workspaces[0] || null;
  const project = state.projects.find((item) => item.id === DEFAULT_PROJECT_ID) || state.projects[0] || null;
  const projectId = project?.id || DEFAULT_PROJECT_ID;

  return {
    workspace,
    project,
    storage,
    counts: {
      experiments: listSortedExperiments(state, projectId).length,
      runs: listSortedRuns(state, projectId).length,
      scoreRecords: listSortedScoreRecords(state, { projectId }).length,
      reports: listSortedReports(state, { projectId }).length,
    },
  };
}

async function listExperiments(rootDir, options = {}) {
  const { projectId = DEFAULT_PROJECT_ID, limit = 50 } = options;
  const { state } = await readState(rootDir);
  return listSortedExperiments(state, projectId).slice(0, limit).map(toExperimentListItem);
}

async function getExperiment(rootDir, id) {
  const { state } = await readState(rootDir);
  const item = state.experiments.find((experiment) => experiment.id === id);
  return item ? toExperimentListItem(item) : null;
}

async function upsertExperiment(rootDir, payload = {}) {
  const { state } = await readState(rootDir);
  const existingIndex = state.experiments.findIndex((experiment) => experiment.id === payload?.id);
  const mergedPayload = existingIndex >= 0 ? mergeExperimentPayload(state.experiments[existingIndex], payload) : payload;
  const normalized = normalizeExperiment(mergedPayload);
  if (!normalized) return null;

  if (existingIndex >= 0) {
    const existing = state.experiments[existingIndex];
    normalized.createdAt = existing.createdAt;
    normalized.updatedAt = Date.now();
    normalized.version = toSafeVersion(payload.version || (existing.version + 1));
    normalized.lastOpenedAt = payload.touchLastOpened ? Date.now() : (toSafeNumber(payload.lastOpenedAt) || existing.lastOpenedAt || normalized.updatedAt);
    state.experiments[existingIndex] = normalized;
  } else {
    const now = Date.now();
    normalized.createdAt = toSafeNumber(payload.createdAt) || now;
    normalized.updatedAt = now;
    normalized.version = toSafeVersion(payload.version);
    normalized.lastOpenedAt = toSafeNumber(payload.lastOpenedAt) || now;
    state.experiments.unshift(normalized);
  }

  state.experiments = listSortedExperiments(state).slice(0, MAX_EXPERIMENTS);
  await writeState(rootDir, state);
  return toExperimentListItem(state.experiments.find((experiment) => experiment.id === normalized.id));
}

async function deleteExperiment(rootDir, id) {
  const { state } = await readState(rootDir);
  const before = state.experiments.length;
  state.experiments = state.experiments.filter((experiment) => experiment.id !== id);
  if (state.experiments.length === before) return false;
  await writeState(rootDir, state);
  return true;
}

async function listRuns(rootDir, options = {}) {
  const { projectId = DEFAULT_PROJECT_ID, experimentId = "", limit = 100 } = options;
  const { state } = await readState(rootDir);
  return listSortedRuns(state, projectId, experimentId).slice(0, limit).map(toRunListItem);
}

async function getRun(rootDir, id) {
  const { state } = await readState(rootDir);
  const item = state.runs.find((run) => run.id === id);
  return item ? toRunListItem(item) : null;
}

async function upsertRun(rootDir, payload = {}) {
  const { state } = await readState(rootDir);
  const existingIndex = state.runs.findIndex((run) => run.id === payload?.id);
  const mergedPayload = existingIndex >= 0 ? mergeRunPayload(state.runs[existingIndex], payload) : payload;
  const normalized = normalizeRun(mergedPayload);
  if (!normalized) return null;

  const now = Date.now();
  if (existingIndex >= 0) {
    const existing = state.runs[existingIndex];
    normalized.createdAt = existing.createdAt;
    normalized.updatedAt = now;
    normalized.version = toSafeVersion(payload.version || (existing.version + 1));
    state.runs[existingIndex] = normalized;
  } else {
    normalized.createdAt = toSafeNumber(payload.createdAt) || now;
    normalized.updatedAt = now;
    normalized.version = toSafeVersion(payload.version);
    state.runs.unshift(normalized);
  }

  const experiment = state.experiments.find((item) => item.id === normalized.experimentId);
  if (experiment) {
    experiment.lastOpenedAt = normalized.updatedAt || normalized.completedAt || normalized.createdAt;
  }

  syncRunArtifacts(state, normalized);
  state.runs = listSortedRuns(state).slice(0, MAX_RUNS);
  await writeState(rootDir, state);
  return toRunListItem(state.runs.find((run) => run.id === normalized.id));
}

async function deleteRun(rootDir, id) {
  const { state } = await readState(rootDir);
  if (!id) {
    state.runs = [];
    state.scoreRecords = [];
    state.reports = [];
    await writeState(rootDir, state);
    return true;
  }

  const before = state.runs.length;
  state.runs = state.runs.filter((run) => run.id !== id);
  if (state.runs.length === before) return false;

  state.scoreRecords = state.scoreRecords.filter((record) => record.runId !== id);
  state.reports = state.reports.filter((report) => report.runId !== id);
  await writeState(rootDir, state);
  return true;
}

async function listScoreRecords(rootDir, options = {}) {
  const { projectId = DEFAULT_PROJECT_ID, experimentId = "", runId = "", scoreType = "", limit = 100 } = options;
  const { state } = await readState(rootDir);
  return listSortedScoreRecords(state, { projectId, experimentId, runId, scoreType }).slice(0, limit).map(toScoreRecordListItem);
}

async function getScoreRecord(rootDir, id) {
  const { state } = await readState(rootDir);
  const item = state.scoreRecords.find((record) => record.id === id);
  return item ? toScoreRecordListItem(item) : null;
}

async function upsertScoreRecord(rootDir, payload = {}) {
  const { state } = await readState(rootDir);
  const existingIndex = state.scoreRecords.findIndex((record) => record.id === payload?.id);
  const mergedPayload = existingIndex >= 0 ? mergeScoreRecordPayload(state.scoreRecords[existingIndex], payload) : payload;
  const normalized = normalizeScoreRecord(mergedPayload);
  if (!normalized) return null;

  const now = Date.now();
  if (existingIndex >= 0) {
    const existing = state.scoreRecords[existingIndex];
    state.scoreRecords[existingIndex] = finalizeCollectionItem(existing, normalized, { now });
  } else {
    state.scoreRecords.unshift(finalizeCollectionItem(null, normalized, { now }));
  }

  state.scoreRecords = listSortedScoreRecords(state, { projectId: "" }).slice(0, MAX_SCORE_RECORDS);
  await writeState(rootDir, state);
  return toScoreRecordListItem(state.scoreRecords.find((record) => record.id === normalized.id));
}

async function deleteScoreRecord(rootDir, id) {
  const { state } = await readState(rootDir);
  if (!id) {
    state.scoreRecords = [];
    await writeState(rootDir, state);
    return true;
  }

  const before = state.scoreRecords.length;
  state.scoreRecords = state.scoreRecords.filter((record) => record.id !== id);
  if (state.scoreRecords.length === before) return false;
  await writeState(rootDir, state);
  return true;
}

async function listReports(rootDir, options = {}) {
  const { projectId = DEFAULT_PROJECT_ID, experimentId = "", runId = "", status = "", limit = 50 } = options;
  const { state } = await readState(rootDir);
  return listSortedReports(state, { projectId, experimentId, runId, status }).slice(0, limit).map(toReportListItem);
}

async function getReport(rootDir, id) {
  const { state } = await readState(rootDir);
  const item = state.reports.find((report) => report.id === id);
  return item ? toReportListItem(item) : null;
}

async function upsertReport(rootDir, payload = {}) {
  const { state } = await readState(rootDir);
  const existingIndex = state.reports.findIndex((report) => report.id === payload?.id);
  const mergedPayload = existingIndex >= 0 ? mergeReportPayload(state.reports[existingIndex], payload) : payload;
  const normalized = normalizeReport(mergedPayload);
  if (!normalized) return null;

  const now = Date.now();
  if (existingIndex >= 0) {
    const existing = state.reports[existingIndex];
    state.reports[existingIndex] = finalizeCollectionItem(existing, normalized, { now });
  } else {
    state.reports.unshift(finalizeCollectionItem(null, normalized, { now }));
  }

  state.reports = listSortedReports(state, { projectId: "" }).slice(0, MAX_REPORTS);
  await writeState(rootDir, state);
  return toReportListItem(state.reports.find((report) => report.id === normalized.id));
}

async function deleteReport(rootDir, id) {
  const { state } = await readState(rootDir);
  if (!id) {
    state.reports = [];
    await writeState(rootDir, state);
    return true;
  }

  const before = state.reports.length;
  state.reports = state.reports.filter((report) => report.id !== id);
  if (state.reports.length === before) return false;
  await writeState(rootDir, state);
  return true;
}

async function getRecentWork(rootDir, options = {}) {
  const { projectId = DEFAULT_PROJECT_ID, experimentId = "", experimentsLimit = 5, runsLimit = 5, reportsLimit = 5 } = options;
  const { state } = await readState(rootDir);
  const allExperiments = listSortedExperiments(state, projectId);
  const allRuns = listSortedRuns(state, projectId, experimentId);
  const allReports = listSortedReports(state, { projectId, experimentId });
  const allScoreRecords = listSortedScoreRecords(state, { projectId, experimentId });
  const experiments = allExperiments.slice(0, experimentsLimit).map(toExperimentListItem);
  const runs = allRuns.slice(0, runsLimit).map(toRunListItem);
  const reports = allReports.slice(0, reportsLimit).map(toReportListItem);
  const latestUpdatedAt = Math.max(
    0,
    ...experiments.map((item) => item.updatedAt || item.savedAt || 0),
    ...runs.map((item) => item.updatedAt || item.completedAt || item.savedAt || 0),
    ...reports.map((item) => item.updatedAt || item.savedAt || 0),
    ...allScoreRecords.slice(0, 20).map((item) => item.updatedAt || item.savedAt || 0),
  );

  return {
    workspaceId: DEFAULT_WORKSPACE_ID,
    projectId,
    experimentCount: allExperiments.length,
    runCount: allRuns.length,
    scoreRecordCount: allScoreRecords.length,
    reportCount: allReports.length,
    experiments,
    runs,
    reports,
    latestUpdatedAt: latestUpdatedAt || null,
  };
}

module.exports = {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_PROJECT_ID,
  buildExperimentSignature,
  buildRunSignature,
  deleteExperiment,
  deleteReport,
  deleteRun,
  deleteScoreRecord,
  getBootstrap,
  getExperiment,
  getRecentWork,
  getReport,
  getRun,
  getScoreRecord,
  getStorageMeta,
  listExperiments,
  listReports,
  listRuns,
  listScoreRecords,
  readState,
  toExperimentListItem,
  toReportListItem,
  toRunListItem,
  toScoreRecordListItem,
  upsertExperiment,
  upsertReport,
  upsertRun,
  upsertScoreRecord,
};
