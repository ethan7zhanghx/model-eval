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

  assert.match(html, /id="inspirationToggleBtn"/);
  assert.match(html, /id="inspirationPanel"/);
  assert.match(app, /function buildInspirationPrompt/);
  assert.match(app, /function generateInspirationForTurn/);
  assert.match(app, /function updateInspirationUsage/);
  assert.match(app, /function buildInspirationDisplayOrder/);
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
