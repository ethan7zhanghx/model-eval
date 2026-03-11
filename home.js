const HISTORY_API = "/api/config-history";
const RUNS_API = "/api/eval-results?limit=5";

const el = {
  homeDraftCount: document.getElementById("homeDraftCount"),
  homeRunCount: document.getElementById("homeRunCount"),
  homeLastUpdated: document.getElementById("homeLastUpdated"),
  recentDraftsList: document.getElementById("recentDraftsList"),
  recentRunsList: document.getElementById("recentRunsList"),
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

function renderDrafts(items) {
  if (!Array.isArray(items) || !items.length) {
    el.recentDraftsList.innerHTML = '<p class="recent-empty">暂无草稿，点击“新建标准评测”开始。</p>';
    el.homeDraftCount.textContent = "0";
    return;
  }

  el.homeDraftCount.textContent = String(items.length);
  el.recentDraftsList.innerHTML = items.slice(0, 5).map((item) => {
    const modelCount = Array.isArray(item.selectedModels) ? item.selectedModels.filter(Boolean).length : 0;
    const rowCount = Array.isArray(item.rows) ? item.rows.length : 0;
    return `
      <a class="recent-item" href="./experiment.html#section-history">
        <div>
          <strong>${item.title || "未命名草稿"}</strong>
          <p>${modelCount} 个模型 · ${rowCount} 个环节</p>
        </div>
        <span>${formatTime(item.savedAt)}</span>
      </a>
    `;
  }).join("");
}

function renderRuns(items) {
  if (!Array.isArray(items) || !items.length) {
    el.recentRunsList.innerHTML = '<p class="recent-empty">暂无运行记录，运行一次实验后会显示在这里。</p>';
    el.homeRunCount.textContent = "0";
    return;
  }

  el.homeRunCount.textContent = String(items.length);
  el.recentRunsList.innerHTML = items.slice(0, 5).map((item) => {
    const rowCount = Array.isArray(item.rows) ? item.rows.length : 0;
    const modelCount = Array.isArray(item.config?.models) ? item.config.models.length : 0;
    return `
      <a class="recent-item" href="./dashboard.html">
        <div>
          <strong>${formatTime(item.savedAt)}</strong>
          <p>${modelCount} 个模型 · ${rowCount} 条样本</p>
        </div>
        <span>${item.config?.scoreMethod || "none"}</span>
      </a>
    `;
  }).join("");
}

async function loadHomeData() {
  let latest = 0;

  try {
    const historyResp = await fetch(HISTORY_API);
    const historyPayload = await historyResp.json();
    const drafts = Array.isArray(historyPayload.items) ? historyPayload.items : [];
    renderDrafts(drafts);
    latest = Math.max(latest, ...drafts.map((item) => Number(item.savedAt) || 0), 0);
  } catch {
    renderDrafts([]);
  }

  try {
    const runsResp = await fetch(RUNS_API);
    const runsPayload = await runsResp.json();
    const runs = Array.isArray(runsPayload.items) ? runsPayload.items : [];
    renderRuns(runs);
    latest = Math.max(latest, ...runs.map((item) => Number(item.savedAt) || 0), 0);
  } catch {
    renderRuns([]);
  }

  el.homeLastUpdated.textContent = latest ? formatTime(latest) : "-";
}

loadHomeData();
