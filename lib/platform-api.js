function toSafeString(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeEvalType(value, rows = []) {
  if (['single_turn', 'multi_turn', 'scenario'].includes(value)) return value;
  return rows.length > 1 ? 'multi_turn' : 'single_turn';
}

function normalizeSourceType(value) {
  if (['manual_prompt', 'prompt_file', 'dataset_import', 'scenario_session'].includes(value)) {
    return value;
  }
  return 'manual_prompt';
}

function createPlatformApi(options) {
  const {
    rootDir,
    platformStore,
    sendJson,
    parseJsonBody,
    sanitizeLimit,
    sanitizeWorkspaceId,
    maxConfigHistory = 30,
  } = options;

  function sanitizeEntityId(value) {
    return toSafeString(value, 120);
  }

  function resolveProjectId(urlObj) {
    return sanitizeEntityId(urlObj.searchParams.get('projectId')) || platformStore.DEFAULT_PROJECT_ID;
  }

  function historyItemToExperimentInput(item, projectId) {
    return {
      id: item?.id,
      workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
      projectId,
      name: item?.title,
      evalType: normalizeEvalType(item?.evalType, Array.isArray(item?.rows) ? item.rows : []),
      status: item?.status || 'draft',
      sourceType: normalizeSourceType(item?.sourceType),
      datasetId: item?.datasetId,
      datasetVersionId: item?.datasetVersionId,
      createdAt: item?.savedAt,
      updatedAt: item?.savedAt,
      lastOpenedAt: item?.savedAt,
      config: {
        provider: item?.provider,
        baseUrl: item?.baseUrl,
        temperature: item?.temperature,
        outputTokenRatio: item?.outputTokenRatio,
        systemPrompt: item?.systemPrompt,
        scoreMethod: item?.scoreMethod,
        judgeModel: item?.judgeModel || item?.judgeModelId,
        judgePrompt: item?.judgePrompt || item?.judgePromptTemplate,
        selectedModels: item?.selectedModels,
        rows: item?.rows,
      },
    };
  }

  function runItemToRunInput(item, projectId) {
    return {
      id: item?.id,
      workspaceId: platformStore.DEFAULT_WORKSPACE_ID,
      projectId,
      experimentId: item?.experimentId,
      evalType: normalizeEvalType(item?.evalType, Array.isArray(item?.rows) ? item.rows : []),
      sourceType: normalizeSourceType(item?.sourceType),
      datasetId: item?.datasetId,
      datasetVersionId: item?.datasetVersionId,
      name: item?.name,
      status: item?.status,
      triggerSource: item?.triggerSource,
      createdAt: item?.createdAt || item?.savedAt,
      updatedAt: item?.updatedAt || item?.savedAt,
      startedAt: item?.startedAt || item?.savedAt,
      completedAt: item?.completedAt || item?.savedAt,
      config: item?.config,
      rows: item?.rows,
      summary: item?.summary,
    };
  }

  function scoreRecordItemToInput(item, projectId) {
    return {
      id: item?.id,
      workspaceId: item?.workspaceId || platformStore.DEFAULT_WORKSPACE_ID,
      projectId: item?.projectId || projectId,
      experimentId: item?.experimentId,
      runId: item?.runId,
      caseKey: item?.caseKey,
      modelId: item?.modelId,
      scoreType: item?.scoreType,
      scoreValue: item?.scoreValue,
      detail: item?.detail,
      createdAt: item?.createdAt || item?.savedAt,
      updatedAt: item?.updatedAt || item?.savedAt,
    };
  }

  function reportItemToInput(item, projectId) {
    return {
      id: item?.id,
      workspaceId: item?.workspaceId || platformStore.DEFAULT_WORKSPACE_ID,
      projectId: item?.projectId || projectId,
      experimentId: item?.experimentId,
      runId: item?.runId,
      title: item?.title,
      status: item?.status,
      summaryMd: item?.summaryMd,
      visibility: item?.visibility,
      createdAt: item?.createdAt || item?.savedAt,
      updatedAt: item?.updatedAt || item?.savedAt,
    };
  }

  async function handleBootstrapApi(req, res) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const payload = await platformStore.getBootstrap(rootDir);
    sendJson(res, 200, payload);
  }

  async function handleRecentWorkApi(req, res, urlObj) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const payload = await platformStore.getRecentWork(rootDir, {
      projectId: resolveProjectId(urlObj),
      experimentId: sanitizeEntityId(urlObj.searchParams.get('experimentId')),
      experimentsLimit: Math.min(20, sanitizeLimit(urlObj.searchParams.get('experimentsLimit') || '5')),
      runsLimit: Math.min(20, sanitizeLimit(urlObj.searchParams.get('runsLimit') || '5')),
      reportsLimit: Math.min(20, sanitizeLimit(urlObj.searchParams.get('reportsLimit') || '5')),
    });
    sendJson(res, 200, payload);
  }

  async function handleExperimentsApi(req, res, urlObj) {
    const id = sanitizeEntityId(urlObj.searchParams.get('id'));
    const projectId = resolveProjectId(urlObj);

    if (req.method === 'GET') {
      if (id) {
        const item = await platformStore.getExperiment(rootDir, id);
        if (!item) {
          sendJson(res, 404, { error: 'Experiment not found' });
          return;
        }
        sendJson(res, 200, { item });
        return;
      }

      const limit = Math.min(200, sanitizeLimit(urlObj.searchParams.get('limit') || '50'));
      const items = await platformStore.listExperiments(rootDir, { projectId, limit });
      sendJson(res, 200, { items, total: items.length, projectId });
      return;
    }

    if (req.method === 'POST' || req.method === 'PATCH') {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid JSON body', detail: String(error) });
        return;
      }

      const incoming = body?.item && typeof body.item === 'object' ? body.item : body;
      const saved = await platformStore.upsertExperiment(rootDir, {
        ...incoming,
        id: incoming?.id || id,
        workspaceId: incoming?.workspaceId || platformStore.DEFAULT_WORKSPACE_ID,
        projectId: incoming?.projectId || projectId,
        touchLastOpened: !!body?.touchLastOpened,
      });

      if (!saved) {
        sendJson(res, 400, { error: 'Invalid experiment payload' });
        return;
      }

      sendJson(res, req.method === 'POST' ? 201 : 200, { item: saved });
      return;
    }

    if (req.method === 'DELETE') {
      if (!id) {
        sendJson(res, 400, { error: 'Experiment id is required' });
        return;
      }
      const ok = await platformStore.deleteExperiment(rootDir, id);
      if (!ok) {
        sendJson(res, 404, { error: 'Experiment not found' });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  }

  async function handleRunsApi(req, res, urlObj) {
    const id = sanitizeEntityId(urlObj.searchParams.get('id'));
    const projectId = resolveProjectId(urlObj);
    const experimentId = sanitizeEntityId(urlObj.searchParams.get('experimentId'));

    if (req.method === 'GET') {
      if (id) {
        const item = await platformStore.getRun(rootDir, id);
        if (!item) {
          sendJson(res, 404, { error: 'Run not found' });
          return;
        }
        sendJson(res, 200, { item });
        return;
      }

      const limit = Math.min(500, sanitizeLimit(urlObj.searchParams.get('limit') || '100'));
      const items = await platformStore.listRuns(rootDir, { projectId, experimentId, limit });
      sendJson(res, 200, { items, total: items.length, projectId });
      return;
    }

    if (req.method === 'POST' || req.method === 'PATCH') {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid JSON body', detail: String(error) });
        return;
      }

      const incoming = body?.item && typeof body.item === 'object' ? body.item : body;
      const saved = await platformStore.upsertRun(rootDir, {
        ...incoming,
        id: incoming?.id || id,
        workspaceId: incoming?.workspaceId || platformStore.DEFAULT_WORKSPACE_ID,
        projectId: incoming?.projectId || projectId,
      });

      if (!saved) {
        sendJson(res, 400, { error: 'Invalid run payload' });
        return;
      }

      sendJson(res, req.method === 'POST' ? 201 : 200, { item: saved });
      return;
    }

    if (req.method === 'DELETE') {
      const ok = await platformStore.deleteRun(rootDir, id);
      sendJson(res, 200, { ok });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  }

  async function handleScoreRecordsApi(req, res, urlObj) {
    const id = sanitizeEntityId(urlObj.searchParams.get('id'));
    const projectId = resolveProjectId(urlObj);
    const experimentId = sanitizeEntityId(urlObj.searchParams.get('experimentId'));
    const runId = sanitizeEntityId(urlObj.searchParams.get('runId'));
    const scoreType = toSafeString(urlObj.searchParams.get('scoreType'), 40);

    if (req.method === 'GET') {
      if (id) {
        const item = await platformStore.getScoreRecord(rootDir, id);
        if (!item) {
          sendJson(res, 404, { error: 'Score record not found' });
          return;
        }
        sendJson(res, 200, { item });
        return;
      }

      const limit = Math.min(1000, sanitizeLimit(urlObj.searchParams.get('limit') || '100'));
      const items = await platformStore.listScoreRecords(rootDir, { projectId, experimentId, runId, scoreType, limit });
      sendJson(res, 200, { items, total: items.length, projectId });
      return;
    }

    if (req.method === 'POST' || req.method === 'PATCH') {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid JSON body', detail: String(error) });
        return;
      }

      const incoming = body?.item && typeof body.item === 'object' ? body.item : body;
      const saved = await platformStore.upsertScoreRecord(rootDir, scoreRecordItemToInput({
        ...incoming,
        id: incoming?.id || id,
      }, projectId));
      if (!saved) {
        sendJson(res, 400, { error: 'Invalid score record payload' });
        return;
      }

      sendJson(res, req.method === 'POST' ? 201 : 200, { item: saved });
      return;
    }

    if (req.method === 'DELETE') {
      const ok = await platformStore.deleteScoreRecord(rootDir, id);
      sendJson(res, 200, { ok });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  }

  async function handleReportsApi(req, res, urlObj) {
    const id = sanitizeEntityId(urlObj.searchParams.get('id'));
    const projectId = resolveProjectId(urlObj);
    const experimentId = sanitizeEntityId(urlObj.searchParams.get('experimentId'));
    const runId = sanitizeEntityId(urlObj.searchParams.get('runId'));
    const status = toSafeString(urlObj.searchParams.get('status'), 40);

    if (req.method === 'GET') {
      if (id) {
        const item = await platformStore.getReport(rootDir, id);
        if (!item) {
          sendJson(res, 404, { error: 'Report not found' });
          return;
        }
        sendJson(res, 200, { item });
        return;
      }

      const limit = Math.min(200, sanitizeLimit(urlObj.searchParams.get('limit') || '50'));
      const items = await platformStore.listReports(rootDir, { projectId, experimentId, runId, status, limit });
      sendJson(res, 200, { items, total: items.length, projectId });
      return;
    }

    if (req.method === 'POST' || req.method === 'PATCH') {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid JSON body', detail: String(error) });
        return;
      }

      const incoming = body?.item && typeof body.item === 'object' ? body.item : body;
      const saved = await platformStore.upsertReport(rootDir, reportItemToInput({
        ...incoming,
        id: incoming?.id || id,
      }, projectId));
      if (!saved) {
        sendJson(res, 400, { error: 'Invalid report payload' });
        return;
      }

      sendJson(res, req.method === 'POST' ? 201 : 200, { item: saved });
      return;
    }

    if (req.method === 'DELETE') {
      const ok = await platformStore.deleteReport(rootDir, id);
      sendJson(res, 200, { ok });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  }

  async function handleHistoryApi(req, res, urlObj) {
    const workspace = sanitizeWorkspaceId(urlObj.searchParams.get('workspace'));
    const projectId = resolveProjectId(urlObj);

    if (req.method === 'GET') {
      const items = await platformStore.listExperiments(rootDir, { projectId, limit: maxConfigHistory });
      sendJson(res, 200, { workspace, items });
      return;
    }

    if (req.method === 'PUT') {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid JSON body', detail: String(error) });
        return;
      }

      const incomingItems = Array.isArray(body?.items) ? body.items : [];
      for (const item of incomingItems.slice(0, maxConfigHistory)) {
        await platformStore.upsertExperiment(rootDir, historyItemToExperimentInput(item, projectId));
      }
      const items = await platformStore.listExperiments(rootDir, { projectId, limit: maxConfigHistory });
      sendJson(res, 200, { workspace, items });
      return;
    }

    if (req.method === 'DELETE') {
      const items = await platformStore.listExperiments(rootDir, { projectId, limit: maxConfigHistory });
      for (const item of items) {
        await platformStore.deleteExperiment(rootDir, item.id);
      }
      sendJson(res, 200, { workspace, items: [] });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  }

  async function handleEvalResultsApi(req, res, urlObj) {
    const projectId = resolveProjectId(urlObj);
    const experimentId = sanitizeEntityId(urlObj.searchParams.get('experimentId'));

    if (req.method === 'GET') {
      const limit = Math.min(500, sanitizeLimit(urlObj.searchParams.get('limit') || '100'));
      const items = await platformStore.listRuns(rootDir, { projectId, experimentId, limit });
      sendJson(res, 200, { items, total: items.length });
      return;
    }

    if (req.method === 'POST') {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (error) {
        sendJson(res, 400, { error: 'Invalid JSON body', detail: String(error) });
        return;
      }

      const item = body?.item && typeof body.item === 'object' ? body.item : body;
      const saved = await platformStore.upsertRun(rootDir, runItemToRunInput(item, projectId));
      if (!saved) {
        sendJson(res, 400, { error: 'Invalid eval result' });
        return;
      }

      sendJson(res, 200, { item: saved });
      return;
    }

    if (req.method === 'DELETE') {
      const id = sanitizeEntityId(urlObj.searchParams.get('id'));
      const ok = await platformStore.deleteRun(rootDir, id);
      sendJson(res, 200, { ok: id ? ok : true });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  }

  return {
    handleBootstrapApi,
    handleRecentWorkApi,
    handleExperimentsApi,
    handleRunsApi,
    handleScoreRecordsApi,
    handleReportsApi,
    handleHistoryApi,
    handleEvalResultsApi,
  };
}

module.exports = {
  createPlatformApi,
};
