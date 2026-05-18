const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('zhumengdao exposes configurable system prompt controls', async () => {
  const [html, app] = await Promise.all([
    fs.readFile(path.join(root, 'zhumengdao', 'index.html'), 'utf8'),
    fs.readFile(path.join(root, 'zhumengdao', 'app.js'), 'utf8'),
  ]);

  assert.match(html, /id="systemPromptInput"/);
  assert.match(app, /DEFAULT_SYSTEM_PROMPT/);
  assert.match(app, /systemPromptInput:\s*document\.getElementById\("systemPromptInput"\)/);
  assert.match(app, /systemPrompt:\s*sanitizeSystemPrompt/);
});
