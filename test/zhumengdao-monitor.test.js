const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAlertEmail, buildTestEmail, evaluateModelWinRate } = require('../api/zhumengdao-monitor');

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

test('zhumengdao monitor builds a concise alert email', () => {
  const email = buildAlertEmail({
    to: 'zhanghaoxin@baidu.com',
    result: {
      targetModel: 'ernie-5.1',
      winRate: 0.5333,
      threshold: 0.55,
      samples: 30,
      wins: 16,
    },
    now: new Date('2026-05-20T12:00:00+08:00'),
  });

  assert.equal(email.subject, '[筑梦岛报警] ernie-5.1 胜率低于 55%');
  assert.match(email.text, /当前胜率：53\.33%/);
  assert.match(email.text, /触发时间：2026\/05\/20 12:00:00/);
  assert.doesNotMatch(email.text, /统计范围/);
  assert.doesNotMatch(email.text, /建议/);
});

test('zhumengdao monitor builds a test email without alert content', () => {
  const email = buildTestEmail({
    to: 'zhanghaoxin@baidu.com',
    targetModel: 'ernie-5.1',
    now: new Date('2026-05-20T12:00:00+08:00'),
  });

  assert.equal(email.subject, '[筑梦岛监控测试] 邮件链路验证成功');
  assert.match(email.text, /这是一封筑梦岛监控测试邮件/);
  assert.match(email.text, /收件人：zhanghaoxin@baidu\.com/);
  assert.doesNotMatch(email.text, /胜率低于阈值/);
});
