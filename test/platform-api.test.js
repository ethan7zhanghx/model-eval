const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const platformStore = require('../lib/platform-store');
const { createPlatformApi } = require('../lib/platform-api');

async function createTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'model-eval-api-'));
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  return root;
}

function sanitizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 300;
  return Math.min(2000, Math.floor(parsed));
}

function sanitizeWorkspaceId(value) {
  const raw = String(value || '').trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64);
  return cleaned || 'default';
}

function createApi(rootDir) {
  const sendJson = (res, statusCode, payload) => {
    res.statusCode = statusCode;
    res.payload = payload;
  };

  const parseJsonBody = async (req) => req.body ?? {};

  return createPlatformApi({
    rootDir,
    platformStore,
    sendJson,
    parseJsonBody,
    sanitizeLimit,
    sanitizeWorkspaceId,
    maxConfigHistory: 30,
  });
}

function createReq(method, body) {
  return { method, body };
}

function createRes() {
  return { statusCode: null, payload: null };
}

test('bootstrap API returns default workspace and project metadata', async () => {
  const root = await createTempRoot();
  const api = createApi(root);
  const res = createRes();

  await api.handleBootstrapApi(createReq('GET'), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.workspace.id, platformStore.DEFAULT_WORKSPACE_ID);
  assert.equal(res.payload.project.id, platformStore.DEFAULT_PROJECT_ID);
  assert.equal(res.payload.counts.experiments, 0);
  assert.equal(res.payload.counts.runs, 0);
});

test('experiments API can create and list experiment drafts', async () => {
  const root = await createTempRoot();
  const api = createApi(root);

  const createResPayload = createRes();
  await api.handleExperimentsApi(
    createReq('POST', {
      item: {
        id: 'exp-api-1',
        name: 'API Draft',
        evalType: 'multi_turn',
        config: {
          provider: 'openrouter',
          baseUrl: '',
          temperature: 0.5,
          outputTokenRatio: 1,
          systemPrompt: 'sys',
          scoreMethod: 'judge',
          judgeModel: 'judge-model',
          judgePrompt: 'score {{response}}',
          selectedModels: ['model-a', 'model-b'],
          rows: [{ prompt: 'hello', scoreRef: 'A' }, { prompt: 'follow up', scoreRef: 'B' }],
        },
      },
    }),
    createResPayload,
    new URL('http://local/api/experiments?projectId=proj-default'),
  );

  assert.equal(createResPayload.statusCode, 201);
  assert.equal(createResPayload.payload.item.id, 'exp-api-1');
  assert.equal(createResPayload.payload.item.title, 'API Draft');
  assert.equal(createResPayload.payload.item.scoreMethod, 'judge');
  assert.equal(createResPayload.payload.item.judgeModel, 'judge-model');
  assert.equal(createResPayload.payload.item.rows[0].scoreRef, 'A');

  const listRes = createRes();
  await api.handleExperimentsApi(
    createReq('GET'),
    listRes,
    new URL('http://local/api/experiments?projectId=proj-default&limit=10'),
  );

  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.payload.total, 1);
  assert.equal(listRes.payload.items[0].id, 'exp-api-1');
  assert.equal(listRes.payload.items[0].scoreMethod, 'judge');
  assert.equal(listRes.payload.items[0].judgeModel, 'judge-model');
});

test('runs API creates linked runs and recent-work API returns aggregated counters', async () => {
  const root = await createTempRoot();
  const api = createApi(root);

  const experimentRes = createRes();
  await api.handleExperimentsApi(
    createReq('POST', {
      item: {
        id: 'exp-linked',
        name: 'Linked Experiment',
        evalType: 'single_turn',
        config: {
          provider: 'openrouter',
          baseUrl: '',
          temperature: 0,
          outputTokenRatio: 1,
          systemPrompt: 'sys',
          selectedModels: ['model-a'],
          rows: [{ prompt: 'prompt-1' }],
        },
      },
    }),
    experimentRes,
    new URL('http://local/api/experiments?projectId=proj-default'),
  );

  const runRes = createRes();
  await api.handleRunsApi(
    createReq('POST', {
      item: {
        id: 'run-api-1',
        experimentId: 'exp-linked',
        name: 'Run API 1',
        status: 'completed',
        triggerSource: 'manual',
        completedAt: 1234,
        config: {
          provider: 'openrouter',
          baseUrl: '',
          models: ['model-a'],
          systemPrompt: 'sys',
          temperature: 0,
          outputTokenRatio: 1,
          scoreMethod: 'none',
        },
        rows: [
          {
            prompt: 'prompt-1',
            scoreRef: '',
            results: {
              'model-a': { ok: true, content: 'done', latencyMs: 12 },
            },
          },
        ],
        summary: {
          rowCount: 1,
          modelCount: 1,
          successCalls: 1,
          totalCalls: 1,
        },
      },
    }),
    runRes,
    new URL('http://local/api/runs?projectId=proj-default'),
  );

  assert.equal(runRes.statusCode, 201);
  assert.equal(runRes.payload.item.experimentId, 'exp-linked');

  const recentRes = createRes();
  await api.handleRecentWorkApi(
    createReq('GET'),
    recentRes,
    new URL('http://local/api/recent-work?projectId=proj-default&experimentsLimit=5&runsLimit=5'),
  );

  assert.equal(recentRes.statusCode, 200);
  assert.equal(recentRes.payload.experimentCount, 1);
  assert.equal(recentRes.payload.runCount, 1);
  assert.equal(recentRes.payload.runs[0].id, 'run-api-1');
});

test('legacy compatibility endpoints map to experiments and runs', async () => {
  const root = await createTempRoot();
  const api = createApi(root);

  const historyPutRes = createRes();
  await api.handleHistoryApi(
    createReq('PUT', {
      items: [
        {
          id: 'cfg-compat-1',
          title: 'Compat Draft',
          savedAt: 321,
          provider: 'openrouter',
          baseUrl: '',
          temperature: 0.3,
          outputTokenRatio: 1,
          systemPrompt: 'compat',
          selectedModels: ['model-a'],
          rows: [{ prompt: 'compat prompt' }],
        },
      ],
    }),
    historyPutRes,
    new URL('http://local/api/config-history?workspace=default&projectId=proj-default'),
  );

  assert.equal(historyPutRes.statusCode, 200);
  assert.equal(historyPutRes.payload.items[0].id, 'cfg-compat-1');

  const evalPostRes = createRes();
  await api.handleEvalResultsApi(
    createReq('POST', {
      item: {
        id: 'run-compat-1',
        experimentId: 'cfg-compat-1',
        savedAt: 654,
        config: {
          provider: 'openrouter',
          models: ['model-a'],
          systemPrompt: 'compat',
          temperature: 0.3,
          outputTokenRatio: 1,
          scoreMethod: 'none',
        },
        rows: [
          {
            prompt: 'compat prompt',
            results: {
              'model-a': { ok: true, content: 'compat result' },
            },
          },
        ],
      },
    }),
    evalPostRes,
    new URL('http://local/api/eval-results?projectId=proj-default'),
  );

  assert.equal(evalPostRes.statusCode, 200);
  assert.equal(evalPostRes.payload.item.id, 'run-compat-1');

  const evalGetRes = createRes();
  await api.handleEvalResultsApi(
    createReq('GET'),
    evalGetRes,
    new URL('http://local/api/eval-results?projectId=proj-default&limit=10'),
  );

  assert.equal(evalGetRes.statusCode, 200);
  assert.equal(evalGetRes.payload.total, 1);
  assert.equal(evalGetRes.payload.items[0].experimentId, 'cfg-compat-1');
});

test('recent-work and runs API support experiment-level scoping', async () => {
  const root = await createTempRoot();
  const api = createApi(root);

  for (const experimentId of ['exp-a', 'exp-b']) {
    await api.handleExperimentsApi(
      createReq('POST', {
        item: {
          id: experimentId,
          name: experimentId,
          evalType: 'single_turn',
          config: {
            provider: 'openrouter',
            baseUrl: '',
            temperature: 0,
            outputTokenRatio: 1,
            systemPrompt: '',
            selectedModels: [experimentId],
            rows: [{ prompt: experimentId }],
          },
        },
      }),
      createRes(),
      new URL('http://local/api/experiments?projectId=proj-default'),
    );

    await api.handleRunsApi(
      createReq('POST', {
        item: {
          id: `run-${experimentId}`,
          experimentId,
          status: 'completed',
          config: {
            provider: 'openrouter',
            baseUrl: '',
            models: [experimentId],
            systemPrompt: '',
            temperature: 0,
            outputTokenRatio: 1,
            scoreMethod: 'none',
          },
          rows: [{ prompt: experimentId, results: { [experimentId]: { ok: true, content: 'ok' } } }],
        },
      }),
      createRes(),
      new URL('http://local/api/runs?projectId=proj-default'),
    );
  }

  const runsRes = createRes();
  await api.handleRunsApi(
    createReq('GET'),
    runsRes,
    new URL('http://local/api/runs?projectId=proj-default&experimentId=exp-a&limit=10'),
  );

  assert.equal(runsRes.statusCode, 200);
  assert.equal(runsRes.payload.total, 1);
  assert.equal(runsRes.payload.items[0].id, 'run-exp-a');

  const recentRes = createRes();
  await api.handleRecentWorkApi(
    createReq('GET'),
    recentRes,
    new URL('http://local/api/recent-work?projectId=proj-default&experimentId=exp-a&experimentsLimit=5&runsLimit=5'),
  );

  assert.equal(recentRes.statusCode, 200);
  assert.equal(recentRes.payload.runCount, 1);
  assert.equal(recentRes.payload.runs[0].id, 'run-exp-a');
});

test('runs API supports lifecycle PATCH updates on the same run record', async () => {
  const root = await createTempRoot();
  const api = createApi(root);

  await api.handleExperimentsApi(
    createReq('POST', {
      item: {
        id: 'exp-life-api',
        name: 'Lifecycle API Experiment',
        evalType: 'single_turn',
        sourceType: 'manual_prompt',
        config: {
          provider: 'openrouter',
          baseUrl: '',
          temperature: 0,
          outputTokenRatio: 1,
          systemPrompt: '',
          selectedModels: ['model-a'],
          rows: [{ prompt: 'hello world' }],
        },
      },
    }),
    createRes(),
    new URL('http://local/api/experiments?projectId=proj-default'),
  );

  const queuedRes = createRes();
  await api.handleRunsApi(
    createReq('POST', {
      item: {
        id: 'run-life-api',
        experimentId: 'exp-life-api',
        evalType: 'single_turn',
        sourceType: 'manual_prompt',
        status: 'queued',
        config: {
          provider: 'openrouter',
          baseUrl: '',
          models: ['model-a'],
          systemPrompt: '',
          temperature: 0,
          outputTokenRatio: 1,
          scoreMethod: 'none',
        },
        rows: [{ prompt: 'hello world', results: {} }],
        summary: { rowCount: 1, modelCount: 1, successCalls: 0, totalCalls: 0 },
      },
    }),
    queuedRes,
    new URL('http://local/api/runs?projectId=proj-default'),
  );

  assert.equal(queuedRes.statusCode, 201);
  assert.equal(queuedRes.payload.item.status, 'queued');
  assert.equal(queuedRes.payload.item.version, 1);

  const runningRes = createRes();
  await api.handleRunsApi(
    createReq('PATCH', {
      item: {
        status: 'running',
        startedAt: 88,
      },
    }),
    runningRes,
    new URL('http://local/api/runs?id=run-life-api&projectId=proj-default'),
  );

  assert.equal(runningRes.statusCode, 200);
  assert.equal(runningRes.payload.item.status, 'running');
  assert.equal(runningRes.payload.item.startedAt, 88);
  assert.equal(runningRes.payload.item.version, 2);

  const completedRes = createRes();
  await api.handleRunsApi(
    createReq('PATCH', {
      item: {
        status: 'partial_success',
        completedAt: 144,
        rows: [{ prompt: 'hello world', results: { 'model-a': { ok: true, content: 'done', latencyMs: 12 } } }],
        summary: { rowCount: 1, modelCount: 1, successCalls: 1, totalCalls: 1 },
      },
    }),
    completedRes,
    new URL('http://local/api/runs?id=run-life-api&projectId=proj-default'),
  );

  assert.equal(completedRes.statusCode, 200);
  assert.equal(completedRes.payload.item.status, 'partial_success');
  assert.equal(completedRes.payload.item.completedAt, 144);
  assert.equal(completedRes.payload.item.version, 3);
  assert.equal(completedRes.payload.item.rows[0].results['model-a'].ok, true);

  const getRes = createRes();
  await api.handleRunsApi(
    createReq('GET'),
    getRes,
    new URL('http://local/api/runs?id=run-life-api&projectId=proj-default'),
  );

  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.payload.item.experimentId, 'exp-life-api');
  assert.equal(getRes.payload.item.startedAt, 88);
  assert.equal(getRes.payload.item.completedAt, 144);
});


test('reports and score-records APIs expose derived run artifacts', async () => {
  const root = await createTempRoot();
  const api = createApi(root);

  await api.handleExperimentsApi(
    createReq('POST', {
      item: {
        id: 'exp-artifact-api',
        name: 'Artifact API Experiment',
        evalType: 'single_turn',
        config: {
          provider: 'openrouter',
          baseUrl: '',
          temperature: 0,
          outputTokenRatio: 1,
          systemPrompt: '',
          selectedModels: ['model-a'],
          rows: [{ prompt: 'prompt-1' }],
        },
      },
    }),
    createRes(),
    new URL('http://local/api/experiments?projectId=proj-default'),
  );

  await api.handleRunsApi(
    createReq('POST', {
      item: {
        id: 'run-artifact-api',
        experimentId: 'exp-artifact-api',
        evalType: 'single_turn',
        sourceType: 'manual_prompt',
        status: 'completed',
        completedAt: 1234,
        config: {
          provider: 'openrouter',
          baseUrl: '',
          models: ['model-a'],
          systemPrompt: '',
          temperature: 0,
          outputTokenRatio: 1,
          scoreMethod: 'judge',
        },
        rows: [
          {
            prompt: 'prompt-1',
            scoreRef: 'api-case-1',
            results: {
              'model-a': {
                ok: true,
                content: 'done',
                manualScore: 5,
                ruleScore: 1,
                judgeScore: 4.2,
                judgeDetail: { accuracy: 4, completeness: 4, fluency: 5, reason: 'solid' },
              },
            },
          },
        ],
        summary: { rowCount: 1, modelCount: 1, successCalls: 1, totalCalls: 1 },
      },
    }),
    createRes(),
    new URL('http://local/api/runs?projectId=proj-default'),
  );

  const reportsRes = createRes();
  await api.handleReportsApi(
    createReq('GET'),
    reportsRes,
    new URL('http://local/api/reports?projectId=proj-default&runId=run-artifact-api&limit=10'),
  );

  assert.equal(reportsRes.statusCode, 200);
  assert.equal(reportsRes.payload.total, 1);
  assert.equal(reportsRes.payload.items[0].runId, 'run-artifact-api');

  const scoreRes = createRes();
  await api.handleScoreRecordsApi(
    createReq('GET'),
    scoreRes,
    new URL('http://local/api/score-records?projectId=proj-default&runId=run-artifact-api&limit=10'),
  );

  assert.equal(scoreRes.statusCode, 200);
  assert.equal(scoreRes.payload.total, 3);
  assert.deepEqual(scoreRes.payload.items.map((item) => item.scoreType).sort(), ['judge', 'manual', 'rule']);

  const recentRes = createRes();
  await api.handleRecentWorkApi(
    createReq('GET'),
    recentRes,
    new URL('http://local/api/recent-work?projectId=proj-default&reportsLimit=5&experimentsLimit=5&runsLimit=5'),
  );

  assert.equal(recentRes.statusCode, 200);
  assert.equal(recentRes.payload.reportCount, 1);
  assert.equal(recentRes.payload.scoreRecordCount, 3);
  assert.equal(recentRes.payload.reports[0].runId, 'run-artifact-api');
});
