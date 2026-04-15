const RECENT_WORK_API = "/api/recent-work?experimentsLimit=5&runsLimit=5&reportsLimit=5";

const el = {
  homeDraftCount: document.getElementById("homeDraftCount"),
  homeRunCount: document.getElementById("homeRunCount"),
  homeScoreRecordCount: document.getElementById("homeScoreRecordCount"),
  homeReportCount: document.getElementById("homeReportCount"),
  homeLastUpdated: document.getElementById("homeLastUpdated"),
  recentDraftsList: document.getElementById("recentDraftsList"),
  recentRunsList: document.getElementById("recentRunsList"),
  recentReportsList: document.getElementById("recentReportsList"),
};

function formatTime(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function renderDrafts(items, totalCount) {
  if (!Array.isArray(items) || !items.length) {
    el.recentDraftsList.innerHTML = '<p class="recent-empty">暂无草稿，点击“标准评测”开始。</p>';
    el.homeDraftCount.textContent = "0";
    return;
  }

  el.homeDraftCount.textContent = String(totalCount ?? items.length);
  el.recentDraftsList.innerHTML = items.map((item) => {
    const modelCount = Array.isArray(item.selectedModels) ? item.selectedModels.filter(Boolean).length : 0;
    const rowCount = Array.isArray(item.rows) ? item.rows.length : 0;
    return `
      <a class="recent-item" href="./experiment.html?experimentId=${encodeURIComponent(item.id)}#section-history">
        <div>
          <strong>${item.title || item.name || "未命名草稿"}</strong>
          <p>${modelCount} 个模型 · ${rowCount} 个环节</p>
        </div>
        <span>${formatTime(item.savedAt || item.updatedAt)}</span>
      </a>
    `;
  }).join("");
}

function renderRuns(items, totalCount) {
  if (!Array.isArray(items) || !items.length) {
    el.recentRunsList.innerHTML = '<p class="recent-empty">暂无运行记录，运行一次实验后会显示在这里。</p>';
    el.homeRunCount.textContent = "0";
    return;
  }

  el.homeRunCount.textContent = String(totalCount ?? items.length);
  el.recentRunsList.innerHTML = items.map((item) => {
    const rowCount = Array.isArray(item.rows) ? item.rows.length : 0;
    const modelCount = Array.isArray(item.config?.models) ? item.config.models.length : 0;
    return `
      <a class="recent-item" href="./dashboard.html?runId=${encodeURIComponent(item.id)}">
        <div>
          <strong>${formatTime(item.completedAt || item.savedAt)}</strong>
          <p>${modelCount} 个模型 · ${rowCount} 条样本</p>
        </div>
        <span>${item.status || item.config?.scoreMethod || "run"}</span>
      </a>
    `;
  }).join("");
}

function extractReportPreview(summaryMd) {
  const lines = String(summaryMd || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#") && !line.startsWith("- Run ID:") && !line.startsWith("- Experiment ID:"));
  return lines[0] || "统一 Run 摘要对象";
}

function renderReports(items, totalCount) {
  if (!Array.isArray(items) || !items.length) {
    el.recentReportsList.innerHTML = '<p class="recent-empty">暂无报告对象；Run 完成后会自动沉淀一份摘要报告。</p>';
    el.homeReportCount.textContent = "0";
    return;
  }

  el.homeReportCount.textContent = String(totalCount ?? items.length);
  el.recentReportsList.innerHTML = items.map((item) => `
    <a class="recent-item" href="./dashboard.html${item.runId ? `?runId=${encodeURIComponent(item.runId)}` : ""}">
      <div>
        <strong>${item.title || "未命名报告"}</strong>
        <p>${extractReportPreview(item.summaryMd)}</p>
      </div>
      <span>${item.status || "draft"}</span>
    </a>
  `).join("");
}

async function loadHomeData() {
  try {
    const resp = await fetch(RECENT_WORK_API);
    const payload = await resp.json();
    if (!resp.ok) throw new Error(payload?.error || `HTTP ${resp.status}`);

    renderDrafts(Array.isArray(payload.experiments) ? payload.experiments : [], payload.experimentCount || 0);
    renderRuns(Array.isArray(payload.runs) ? payload.runs : [], payload.runCount || 0);
    renderReports(Array.isArray(payload.reports) ? payload.reports : [], payload.reportCount || 0);
    el.homeScoreRecordCount.textContent = String(payload.scoreRecordCount || 0);
    el.homeLastUpdated.textContent = payload.latestUpdatedAt ? formatTime(payload.latestUpdatedAt) : "-";
  } catch {
    renderDrafts([], 0);
    renderRuns([], 0);
    renderReports([], 0);
    el.homeScoreRecordCount.textContent = "0";
    el.homeReportCount.textContent = "0";
    el.homeLastUpdated.textContent = "-";
  }
}

loadHomeData();
