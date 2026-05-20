const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('zhumengdao inspiration mode has chat UI and persistence contracts', async () => {
  const [html, app, recordsApi, server, stats] = await Promise.all([
    fs.readFile(path.join(root, 'zhumengdao', 'index.html'), 'utf8'),
    fs.readFile(path.join(root, 'zhumengdao', 'app.js'), 'utf8'),
    fs.readFile(path.join(root, 'api', 'zhumengdao-records.js'), 'utf8'),
    fs.readFile(path.join(root, 'server.js'), 'utf8'),
    fs.readFile(path.join(root, 'zhumengdao', 'stats.html'), 'utf8'),
  ]);

  assert.doesNotMatch(html, /id="inspirationToggleBtn"/);
  assert.match(html, /id="inspirationPanel"/);
  assert.match(app, /function buildInspirationPrompt/);
  assert.match(app, /function generateInspirationForTurn/);
  assert.match(app, /function updateInspirationUsage/);
  assert.match(app, /function buildInspirationDisplayOrder/);
  assert.match(app, /function parseInspirationOptions/);
  assert.match(app, /data-assist-action="inspiration"/);
  assert.match(app, /现在是在模拟 User 与/);
  assert.match(app, /中文括号（）/);
  assert.match(app, /请只输出可解析 JSON/);
  assert.doesNotMatch(app, /请保留你自己的表达风格/);
  assert.doesNotMatch(app, /保持对话交流状态，不要写成长段内容/);
  assert.doesNotMatch(app, /INSPIRATION_MAX_TOKENS/);
  assert.match(app, /kind:\s*"inspiration"/);
  assert.match(recordsApi, /normalizeInspirationOptions/);
  assert.match(recordsApi, /function getRecordsKey\(\)/);
  assert.match(recordsApi, /redis\.lset\(recordsKey/);
  assert.doesNotMatch(recordsApi, /await redis\.del\(RECORDS_KEY\);\n\s*for \(let i = next\.length - 1/);
  assert.match(server, /normalizeInspirationOptions/);
  assert.match(stats, /function buildInspirationStats/);
  assert.match(stats, /灵感模式 A\/B/);
  assert.match(stats, /灵感模型排名/);
  assert.match(stats, /灵感对战矩阵/);
  assert.match(stats, /灵感速度统计/);
  assert.match(stats, /inspirationMatrixBody/);
  assert.match(stats, /inspirationPerfTableBody/);
  assert.match(stats, /grid-template-columns:\s*28px minmax\(180px, 1fr\) minmax\(120px, 180px\) 132px/);
  assert.match(stats, /style="width:\$\{wr\}%"/);
  assert.doesNotMatch(stats, /s \/ maxScore \* 100/);
  assert.doesNotMatch(stats, /采用后编辑/);
  assert.doesNotMatch(stats, /采用率/);
});

test('zhumengdao continue chat has manual AB flow and separate stats', async () => {
  const [app, recordsApi, server, stats] = await Promise.all([
    fs.readFile(path.join(root, 'zhumengdao', 'app.js'), 'utf8'),
    fs.readFile(path.join(root, 'api', 'zhumengdao-records.js'), 'utf8'),
    fs.readFile(path.join(root, 'server.js'), 'utf8'),
    fs.readFile(path.join(root, 'zhumengdao', 'stats.html'), 'utf8'),
  ]);

  assert.match(app, /function buildContinuePrompt/);
  assert.match(app, /function generateContinueForLatest/);
  assert.match(app, /function chooseContinue/);
  assert.match(app, /data-assist-action="continue"/);
  assert.match(app, /displayOrder:\s*Math\.random\(\) < 0\.5 \? \["a", "b"\] : \["b", "a"\]/);
  assert.match(app, /kind:\s*"continue"/);
  assert.match(app, /action:\s*"continue"/);
  assert.match(app, /const responses = updated\.responses \|\| \{ a: updated\.apiA, b: updated\.apiB \};/);
  assert.match(app, /state\.assistTarget = \{ record, selectedContent \};\n\s*state\.pendingTurn = null;\n\s*setBusy\(false\);/);
  assert.doesNotMatch(app, /await generateInspirationForTurn\(record, selectedContent\)/);
  assert.match(recordsApi, /"continue"/);
  assert.match(server, /"continue"/);
  assert.match(stats, /继续聊 A\/B/);
  assert.match(stats, /function buildContinueStats/);
  assert.match(stats, /continueStatsPane/);
});

test('zhumengdao session restore preserves meta message types', async () => {
  const [app, sessionsApi, server] = await Promise.all([
    fs.readFile(path.join(root, 'zhumengdao', 'app.js'), 'utf8'),
    fs.readFile(path.join(root, 'api', 'zhumengdao-sessions.js'), 'utf8'),
    fs.readFile(path.join(root, 'server.js'), 'utf8'),
  ]);

  assert.match(sessionsApi, /m\?\.type === "inspiration"/);
  assert.match(sessionsApi, /m\?\.type === "continue"/);
  assert.match(sessionsApi, /normalizeSessionMessage/);
  assert.match(server, /m\?\.type === "inspiration"/);
  assert.match(server, /m\?\.type === "continue"/);
  assert.match(server, /normalizeZmdSessionMessage/);
  assert.match(app, /if \(!m\.content\) return null;/);
  assert.match(app, /\.filter\(Boolean\)/);
});
