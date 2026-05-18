const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('zhumengdao custom roles are pinned and include gender support', async () => {
  const [rolesData, app] = await Promise.all([
    fs.readFile(path.join(root, 'zhumengdao', 'roles.json'), 'utf8'),
    fs.readFile(path.join(root, 'zhumengdao', 'app.js'), 'utf8'),
  ]);
  const roles = JSON.parse(rolesData).roles;

  assert.deepEqual(roles.slice(0, 4).map((role) => role.nickname), ['凌意', '何最', '裴君肆', '程许']);
  assert.deepEqual(roles.slice(0, 4).map((role) => role.gender), ['男', '男', '男', '男']);
  assert.match(app, /gender:\s*String\(item\?\.gender/);
  assert.match(app, /role\.gender \? `性别：\$\{role\.gender\}`/);
});
