const test = require('node:test');
const assert = require('node:assert/strict');

const {
  namespacedKey,
  normalizeStorageNamespace,
} = require('../lib/storage-namespace');

test('storage namespace leaves keys unchanged when unset', () => {
  assert.equal(namespacedKey('zhumengdao:duel-records:v1', ''), 'zhumengdao:duel-records:v1');
});

test('storage namespace prefixes keys when configured', () => {
  assert.equal(
    namespacedKey('zhumengdao:duel-records:v1', 'interval'),
    'interval:zhumengdao:duel-records:v1',
  );
});

test('storage namespace normalizes unsafe env values', () => {
  assert.equal(normalizeStorageNamespace(' interval model eval '), 'interval-model-eval');
  assert.equal(
    namespacedKey('openrouter-case-runner:config-history:default', 'interval model eval'),
    'interval-model-eval:openrouter-case-runner:config-history:default',
  );
});
