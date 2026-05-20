const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateModelWinRate } = require('../api/zhumengdao-monitor');

function vote({ a = 'ernie-5.1', b = 'doubao', selected = 'a', selectedModel = '' } = {}) {
  return {
    action: 'vote',
    kind: 'duel',
    selected,
    selectedModel,
    apiA: { model: a, ok: true },
    apiB: { model: b, ok: true },
  };
}

test('zhumengdao monitor alerts when ernie normal-chat win rate drops below threshold', () => {
  const records = [
    ...Array.from({ length: 16 }, () => vote({ selected: 'a' })),
    ...Array.from({ length: 14 }, () => vote({ selected: 'b' })),
  ];

  const result = evaluateModelWinRate(records, {
    targetModel: 'ernie-5.1',
    threshold: 0.55,
    minSamples: 30,
  });

  assert.equal(result.samples, 30);
  assert.equal(result.wins, 16);
  assert.equal(result.winRate, 0.5333);
  assert.equal(result.shouldAlert, true);
});

test('zhumengdao monitor ignores inspiration and continue records', () => {
  const records = [
    ...Array.from({ length: 16 }, () => vote({ selected: 'a' })),
    ...Array.from({ length: 14 }, () => vote({ selected: 'b' })),
    ...Array.from({ length: 20 }, () => ({
      action: 'continue',
      kind: 'continue',
      selected: 'b',
      apiA: { model: 'ernie-5.1', ok: true },
      apiB: { model: 'doubao', ok: true },
    })),
  ];

  const result = evaluateModelWinRate(records, {
    targetModel: 'ernie-5.1',
    threshold: 0.55,
    minSamples: 30,
  });

  assert.equal(result.samples, 30);
  assert.equal(result.wins, 16);
  assert.equal(result.shouldAlert, true);
});

test('zhumengdao monitor waits for the minimum sample size', () => {
  const records = Array.from({ length: 10 }, () => vote({ selected: 'b' }));

  const result = evaluateModelWinRate(records, {
    targetModel: 'ernie-5.1',
    threshold: 0.55,
    minSamples: 30,
  });

  assert.equal(result.samples, 10);
  assert.equal(result.shouldAlert, false);
  assert.equal(result.reason, 'INSUFFICIENT_SAMPLES');
});
