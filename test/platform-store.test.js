const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const platformStore = require('../lib/platform-store');

async function createTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'model-eval-store-'));
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  return root;
}

async function writeJson(root, fileName, payload) {
  const filePath = path.join(root, 'data', fileName);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

test('migrates legacy drafts and matching runs into unified platform state', async () => {
  const root = await createTempRoot();

  await writeJson(root, 'config-history.json', {
    default: [
      {
        id: 'cfg-legacy-1',
        title: 'Legacy Draft',
        savedAt: 101,
        temperature: 0.2,
        outputTokenRatio: 1,
        provider: 'openrouter',
        baseUrl: '',
        systemPrompt: 'system',
        selectedModels: ['model-a', 'model-b'],
        rows: [{ prompt: 'hello world' }],
      },
    ],
  });

  await writeJson(root, 'eval-results.json', [
    {
      id: 'run-legacy-1',
      savedAt: 202,
      config: {
        provider: 'openrouter',
        baseUrl: '',
        models: ['model-a', 'model-b'],
        systemPrompt: 'system',
        temperature: 0.2,
        outputTokenRatio: 1,
        scoreMethod: 'none',
      },
      rows: [
        {
          prompt: 'hello world',
          results: {
            'model-a': { ok: true, content: 'A' },
            'model-b': { ok: true, content: 'B' },
          },
        },
      ],
    },
  ]);

  const { state } = await platformStore.readState(root);
  const experiment = state.experiments.find((item) => item.id === 'cfg-legacy-1');
  const run = state.runs.find((item) => item.id === 'run-legacy-1');

  assert.ok(experiment, 'legacy draft should be migrated into experiment');
  assert.ok(run, 'legacy run should be migrated into run');
  assert.equal(run.experimentId, 'cfg-legacy-1');
  assert.equal(run.summary.rowCount, 1);
  assert.equal(run.summary.modelCount, 2);
});

test('creates experiment drafts and exposes them in recent work ordering', async () => {
  const root = await createTempRoot();

  const first = await platformStore.upsertExperiment(root, {
    id: 'exp-first',
    workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
    projectId: platformStore.DEFAULT_PROJECT_ID,
    name: 'First Experiment',
    evalType: 'single_turn',
    config: {
      provider: 'openrouter',
      baseUrl: '',
      temperature: 0,
      outputTokenRatio: 1,
      systemPrompt: '',
      selectedModels: ['model-a'],
      rows: [{ prompt: 'first prompt' }],
    },
  });

  const second = await platformStore.upsertExperiment(root, {
    id: 'exp-second',
    workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
    projectId: platformStore.DEFAULT_PROJECT_ID,
    name: 'Second Experiment',
    evalType: 'multi_turn',
    config: {
      provider: 'openrouter',
      baseUrl: '',
      temperature: 0.4,
      outputTokenRatio: 1.2,
      systemPrompt: 'sys',
      selectedModels: ['model-a', 'model-b'],
      rows: [{ prompt: 'second prompt' }, { prompt: 'follow up' }],
    },
  });

  assert.equal(first.id, 'exp-first');
  assert.equal(second.id, 'exp-second');

  const recent = await platformStore.getRecentWork(root, {
    projectId: platformStore.DEFAULT_PROJECT_ID,
    experimentsLimit: 5,
    runsLimit: 5,
  });

  assert.equal(recent.experimentCount, 2);
  assert.equal(recent.runs.length, 0);
  assert.equal(recent.experiments[0].id, 'exp-second');
  assert.equal(recent.experiments[1].id, 'exp-first');
});

test('persists experiment and run score configuration fields', async () => {
  const root = await createTempRoot();

  const experiment = await platformStore.upsertExperiment(root, {
    id: 'exp-score-config',
    workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
    projectId: platformStore.DEFAULT_PROJECT_ID,
    name: 'Score Config Experiment',
    evalType: 'single_turn',
    config: {
      provider: 'openrouter',
      baseUrl: '',
      temperature: 0.3,
      outputTokenRatio: 1,
      systemPrompt: 'sys',
      scoreMethod: 'judge',
      judgeModel: 'judge-model',
      judgePrompt: 'score {{response}}',
      selectedModels: ['model-a'],
      rows: [{ prompt: 'hello', scoreRef: 'world' }],
    },
  });

  const run = await platformStore.upsertRun(root, {
    id: 'run-score-config',
    workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
    projectId: platformStore.DEFAULT_PROJECT_ID,
    experimentId: experiment.id,
    name: 'Run Score Config',
    status: 'completed',
    triggerSource: 'manual',
    config: {
      provider: 'openrouter',
      baseUrl: '',
      models: ['model-a'],
      systemPrompt: 'sys',
      temperature: 0.3,
      outputTokenRatio: 1,
      scoreMethod: 'judge',
      judgeModel: 'judge-model',
      judgePrompt: 'score {{response}}',
    },
    rows: [{
      prompt: 'hello',
      scoreRef: 'world',
      results: {
        'model-a': { ok: true, content: 'world', judgeScore: 4.5 },
      },
    }],
    summary: {
      rowCount: 1,
      modelCount: 1,
      successCalls: 1,
      totalCalls: 1,
    },
  });

  assert.equal(experiment.scoreMethod, 'judge');
  assert.equal(experiment.judgeModel, 'judge-model');
  assert.equal(experiment.rows[0].scoreRef, 'world');
  assert.equal(run.config.scoreMethod, 'judge');
  assert.equal(run.config.judgeModel, 'judge-model');
  assert.equal(run.config.judgePrompt, 'score {{response}}');
});

test('creates runs linked to experiments and updates recent work counters', async () => {
  const root = await createTempRoot();

  const experiment = await platformStore.upsertExperiment(root, {
    id: 'exp-run-base',
    workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
    projectId: platformStore.DEFAULT_PROJECT_ID,
    name: 'Run Base Experiment',
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
  });

  const run = await platformStore.upsertRun(root, {
    id: 'run-1',
    workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
    projectId: platformStore.DEFAULT_PROJECT_ID,
    experimentId: experiment.id,
    name: 'Run 1',
    status: 'completed',
    triggerSource: 'manual',
    completedAt: 500,
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
          'model-a': { ok: true, content: 'done', latencyMs: 20 },
        },
      },
    ],
    summary: {
      rowCount: 1,
      modelCount: 1,
      successCalls: 1,
      totalCalls: 1,
    },
  });

  const recent = await platformStore.getRecentWork(root, {
    projectId: platformStore.DEFAULT_PROJECT_ID,
    experimentsLimit: 5,
    runsLimit: 5,
  });

  assert.equal(run.experimentId, experiment.id);
  assert.equal(recent.experimentCount, 1);
  assert.equal(recent.runCount, 1);
  assert.equal(recent.runs[0].id, 'run-1');
  assert.equal(recent.runs[0].summary.successCalls, 1);
});

test('creates legacy imported experiment bucket for unmatched legacy runs', async () => {
  const root = await createTempRoot();

  await writeJson(root, 'eval-results.json', [
    {
      id: 'run-unmatched',
      savedAt: 999,
      config: {
        provider: 'openrouter',
        models: ['model-x'],
        systemPrompt: 'different-system',
        temperature: 0.9,
        scoreMethod: 'none',
      },
      rows: [
        {
          prompt: 'legacy prompt',
          results: {
            'model-x': { ok: false, content: 'error' },
          },
        },
      ],
    },
  ]);

  const { state } = await platformStore.readState(root);
  const legacyBucket = state.experiments.find((item) => item.id === 'exp-legacy-imported');
  const run = state.runs.find((item) => item.id === 'run-unmatched');

  assert.ok(legacyBucket, 'unmatched legacy runs should create a legacy bucket experiment');
  assert.ok(run, 'legacy run should still migrate');
  assert.equal(run.experimentId, 'exp-legacy-imported');
});

test('filters runs by experiment and keeps recent work scoped to that experiment', async () => {
  const root = await createTempRoot();

  await platformStore.upsertExperiment(root, {
    id: 'exp-a',
    workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
    projectId: platformStore.DEFAULT_PROJECT_ID,
    name: 'Experiment A',
    evalType: 'single_turn',
    config: {
      provider: 'openrouter',
      baseUrl: '',
      temperature: 0,
      outputTokenRatio: 1,
      systemPrompt: '',
      selectedModels: ['model-a'],
      rows: [{ prompt: 'a' }],
    },
  });

  await platformStore.upsertExperiment(root, {
    id: 'exp-b',
    workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
    projectId: platformStore.DEFAULT_PROJECT_ID,
    name: 'Experiment B',
    evalType: 'single_turn',
    config: {
      provider: 'openrouter',
      baseUrl: '',
      temperature: 0,
      outputTokenRatio: 1,
      systemPrompt: '',
      selectedModels: ['model-b'],
      rows: [{ prompt: 'b' }],
    },
  });

  await platformStore.upsertRun(root, {
    id: 'run-a',
    workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
    projectId: platformStore.DEFAULT_PROJECT_ID,
    experimentId: 'exp-a',
    status: 'completed',
    config: { provider: 'openrouter', models: ['model-a'], systemPrompt: '', temperature: 0, outputTokenRatio: 1, scoreMethod: 'none' },
    rows: [{ prompt: 'a', results: { 'model-a': { ok: true, content: 'done' } } }],
  });

  await platformStore.upsertRun(root, {
    id: 'run-b',
    workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
    projectId: platformStore.DEFAULT_PROJECT_ID,
    experimentId: 'exp-b',
    status: 'completed',
    config: { provider: 'openrouter', models: ['model-b'], systemPrompt: '', temperature: 0, outputTokenRatio: 1, scoreMethod: 'none' },
    rows: [{ prompt: 'b', results: { 'model-b': { ok: true, content: 'done' } } }],
  });

  const runsForA = await platformStore.listRuns(root, {
    projectId: platformStore.DEFAULT_PROJECT_ID,
    experimentId: 'exp-a',
    limit: 10,
  });
  const recentForA = await platformStore.getRecentWork(root, {
    projectId: platformStore.DEFAULT_PROJECT_ID,
    experimentId: 'exp-a',
    experimentsLimit: 5,
    runsLimit: 5,
  });

  assert.equal(runsForA.length, 1);
  assert.equal(runsForA[0].id, 'run-a');
  assert.equal(recentForA.runCount, 1);
  assert.equal(recentForA.runs[0].id, 'run-a');
});

test('reports storage metadata and falls back to local-file when database adapter is not configured', async () => {
  const root = await createTempRoot();
  const previous = process.env.MODEL_EVAL_STORAGE_DRIVER;
  process.env.MODEL_EVAL_STORAGE_DRIVER = 'database';

  try {
    const meta = platformStore.getStorageMeta(root);
    const bootstrap = await platformStore.getBootstrap(root);

    assert.equal(meta.requestedDriver, 'database');
    assert.equal(meta.activeDriver, 'local-file');
    assert.match(meta.fallbackReason, /database adapter not configured/);
    assert.equal(bootstrap.storage.activeDriver, 'local-file');
  } finally {
    if (previous == null) {
      delete process.env.MODEL_EVAL_STORAGE_DRIVER;
    } else {
      process.env.MODEL_EVAL_STORAGE_DRIVER = previous;
    }
  }
});

test('repairs extended platform collections and object versions', async () => {
  const root = await createTempRoot();
  const { state } = await platformStore.readState(root);

  assert.equal(state.version, 2);
  assert.equal(state.workspaces[0].version, 1);
  assert.equal(state.projects[0].version, 1);
  assert.deepEqual(state.datasets, []);
  assert.deepEqual(state.scoreRecords, []);
  assert.deepEqual(state.reports, []);
});

test('updates run lifecycle in place without losing experiment linkage or payload', async () => {
  const root = await createTempRoot();

  await platformStore.upsertExperiment(root, {
    id: 'exp-lifecycle',
    workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
    projectId: platformStore.DEFAULT_PROJECT_ID,
    name: 'Lifecycle Experiment',
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
  });

  const queued = await platformStore.upsertRun(root, {
    id: 'run-lifecycle',
    workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
    projectId: platformStore.DEFAULT_PROJECT_ID,
    experimentId: 'exp-lifecycle',
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
    summary: {
      rowCount: 1,
      modelCount: 1,
      successCalls: 0,
      totalCalls: 0,
    },
  });

  const running = await platformStore.upsertRun(root, {
    id: 'run-lifecycle',
    status: 'running',
    startedAt: 200,
  });

  const completed = await platformStore.upsertRun(root, {
    id: 'run-lifecycle',
    status: 'completed',
    startedAt: 200,
    completedAt: 350,
    rows: [
      {
        prompt: 'hello world',
        results: {
          'model-a': { ok: true, content: 'done', latencyMs: 18 },
        },
      },
    ],
    summary: {
      rowCount: 1,
      modelCount: 1,
      successCalls: 1,
      totalCalls: 1,
    },
  });

  assert.equal(queued.version, 1);
  assert.equal(running.version, 2);
  assert.equal(completed.version, 3);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.experimentId, 'exp-lifecycle');
  assert.equal(completed.startedAt, 200);
  assert.equal(completed.completedAt, 350);
  assert.equal(completed.rows[0].prompt, 'hello world');
  assert.equal(completed.rows[0].results['model-a'].ok, true);
});


test('derives score records and reports from completed runs', async () => {
  const root = await createTempRoot();

  await platformStore.upsertExperiment(root, {
    id: 'exp-derived-artifacts',
    workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
    projectId: platformStore.DEFAULT_PROJECT_ID,
    name: 'Derived Artifacts Experiment',
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
  });

  await platformStore.upsertRun(root, {
    id: 'run-derived-artifacts',
    workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
    projectId: platformStore.DEFAULT_PROJECT_ID,
    experimentId: 'exp-derived-artifacts',
    evalType: 'single_turn',
    sourceType: 'manual_prompt',
    status: 'completed',
    completedAt: 500,
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
        prompt: 'hello world',
        scoreRef: 'case-1',
        results: {
          'model-a': {
            ok: true,
            content: 'done',
            latencyMs: 18,
            manualScore: 4,
            ruleScore: 1,
            judgeScore: 4.5,
            judgeDetail: { accuracy: 5, completeness: 4, fluency: 4, reason: 'good' },
          },
        },
      },
    ],
    summary: {
      rowCount: 1,
      modelCount: 1,
      successCalls: 1,
      totalCalls: 1,
    },
  });

  const reports = await platformStore.listReports(root, {
    projectId: platformStore.DEFAULT_PROJECT_ID,
    runId: 'run-derived-artifacts',
    limit: 10,
  });
  const scoreRecords = await platformStore.listScoreRecords(root, {
    projectId: platformStore.DEFAULT_PROJECT_ID,
    runId: 'run-derived-artifacts',
    limit: 10,
  });
  const recent = await platformStore.getRecentWork(root, {
    projectId: platformStore.DEFAULT_PROJECT_ID,
    experimentsLimit: 5,
    runsLimit: 5,
    reportsLimit: 5,
  });

  assert.equal(reports.length, 1);
  assert.equal(reports[0].runId, 'run-derived-artifacts');
  assert.match(reports[0].summaryMd, /Score Records: 3/);
  assert.equal(scoreRecords.length, 3);
  assert.deepEqual(scoreRecords.map((item) => item.scoreType).sort(), ['judge', 'manual', 'rule']);
  assert.equal(recent.reportCount, 1);
  assert.equal(recent.scoreRecordCount, 3);
  assert.equal(recent.reports[0].runId, 'run-derived-artifacts');
});

test('deleting a run also removes its derived reports and score records', async () => {
  const root = await createTempRoot();

  await platformStore.upsertRun(root, {
    id: 'run-delete-artifacts',
    workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
    projectId: platformStore.DEFAULT_PROJECT_ID,
    experimentId: 'exp-delete-artifacts',
    evalType: 'single_turn',
    sourceType: 'manual_prompt',
    status: 'completed',
    completedAt: 600,
    config: {
      provider: 'openrouter',
      baseUrl: '',
      models: ['model-a'],
      systemPrompt: '',
      temperature: 0,
      outputTokenRatio: 1,
      scoreMethod: 'none',
    },
    rows: [
      {
        prompt: 'cleanup',
        scoreRef: 'cleanup-1',
        results: {
          'model-a': { ok: true, content: 'done', manualScore: 5 },
        },
      },
    ],
    summary: {
      rowCount: 1,
      modelCount: 1,
      successCalls: 1,
      totalCalls: 1,
    },
  });

  assert.equal((await platformStore.listReports(root, { projectId: platformStore.DEFAULT_PROJECT_ID, runId: 'run-delete-artifacts', limit: 10 })).length, 1);
  assert.equal((await platformStore.listScoreRecords(root, { projectId: platformStore.DEFAULT_PROJECT_ID, runId: 'run-delete-artifacts', limit: 10 })).length, 1);

  const deleted = await platformStore.deleteRun(root, 'run-delete-artifacts');
  assert.equal(deleted, true);
  assert.equal((await platformStore.listReports(root, { projectId: platformStore.DEFAULT_PROJECT_ID, runId: 'run-delete-artifacts', limit: 10 })).length, 0);
  assert.equal((await platformStore.listScoreRecords(root, { projectId: platformStore.DEFAULT_PROJECT_ID, runId: 'run-delete-artifacts', limit: 10 })).length, 0);
});
