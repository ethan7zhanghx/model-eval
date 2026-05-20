const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAlertEmail,
  buildTestEmail,
  evaluateModelWinRate,
  resolveAlertRecipients,
} = require('../api/zhumengdao-monitor');

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

  assert.equal(email.subject, '[筑梦岛监控测试] ERNIE-5.1 胜率报警邮件测试');
  assert.match(email.text, /用于确认报警邮件可以正常发送/);
  assert.match(email.text, /当 ERNIE-5\.1 在正常对话 A\/B 评测中的胜率低于 55%/);
  assert.match(email.text, /触发条件：ERNIE-5\.1 胜率低于 55%，且样本数不少于 30/);
  assert.match(email.text, /自动检查时间：每天 10:00（北京时间）自动检查一次/);
  assert.match(email.text, /本邮件仅用于测试邮件发送链路/);
});

test('zhumengdao monitor sends to default alert recipients', () => {
  assert.deepEqual(resolveAlertRecipients('zhanghaoxin@baidu.com'), [
    'zhanghaoxin@baidu.com',
    'zhouchenyue@baidu.com',
  ]);
});
