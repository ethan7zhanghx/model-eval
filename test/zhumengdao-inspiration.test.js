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
  assert.match(app, /括号后接1到2句台词/);
  assert.match(app, /不要换行/);
  assert.doesNotMatch(app, /INSPIRATION_MAX_TOKENS/);
  assert.match(app, /kind:\s*"inspiration"/);
  assert.match(recordsApi, /normalizeInspirationOptions/);
  assert.match(recordsApi, /redis\.lset\(RECORDS_KEY/);
  assert.doesNotMatch(recordsApi, /await redis\.del\(RECORDS_KEY\);\n\s*for \(let i = next\.length - 1/);
  assert.match(server, /normalizeInspirationOptions/);
  assert.match(stats, /function buildInspirationStats/);
  assert.match(stats, /灵感模式 A\/B/);
  assert.match(stats, /灵感模型排名/);
  assert.doesNotMatch(stats, /采用后编辑/);
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
  assert.doesNotMatch(app, /await generateInspirationForTurn\(record, selectedContent\)/);
  assert.match(recordsApi, /"continue"/);
  assert.match(server, /"continue"/);
  assert.match(stats, /继续聊 A\/B/);
  assert.match(stats, /function buildContinueStats/);
  assert.match(stats, /continueStatsPane/);
});
