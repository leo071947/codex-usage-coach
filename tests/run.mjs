// 自检：node tests/run.mjs（或 npm test）
// 覆盖：窗口滚推、标定、计划公式、真实日志端到端、MCP stdio 协议冒烟
import { testHome } from './fixture.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';

import { DEFAULTS, publicConfig, sanitizeForTest } from '../plugins/codex-usage-coach/server/lib/config.mjs';
import { buildMetrics, rollForward, windowBucket } from '../plugins/codex-usage-coach/server/lib/metrics.mjs';
import { computePlan } from '../plugins/codex-usage-coach/server/lib/plan.mjs';
import { scanUsage } from '../plugins/codex-usage-coach/server/lib/scanner.mjs';
import { bar, fmtDur, fmtTokens, localDateKey, msUntilLocalMidnight } from '../plugins/codex-usage-coach/server/lib/util.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') throw new Error('同步测试不能返回 Promise');
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n     ${err.message}`);
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n     ${err.message}`);
  }
}
const near = (actual, expected, tol = 0.01, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label} 期望 ${expected}±${tol}，实际 ${actual}`);

console.log('\n[1] 格式化与工具函数');
test('fmtTokens 缩写', () => {
  assert.equal(fmtTokens(0), '0');
  assert.equal(fmtTokens(999), '999');
  assert.equal(fmtTokens(1536), '1.54K');
  assert.equal(fmtTokens(2846865), '2.85M');
});
test('bar 宽度固定且只有两种字符', () => {
  const b = bar(50, 20);
  assert.equal([...b].length, 20);
  assert.ok(/^[█░]+$/.test(b));
  assert.equal(bar(0, 10), '░'.repeat(10));
  assert.equal(bar(100, 10), '█'.repeat(10));
  assert.equal(bar(150, 10), '█'.repeat(10));
  assert.equal(bar(-5, 10), '░'.repeat(10));
});
test('fmtDur 中文', () => {
  assert.equal(fmtDur(0), '0 分');
  assert.equal(fmtDur(90 * 1000), '1 分钟');
  assert.ok(fmtDur(4 * DAY + 3 * HOUR + 19 * 60000).includes('天'));
  assert.ok(fmtDur(90 * 60000).includes('小时'));
  assert.equal(fmtDur(-HOUR), '-1 小时 0 分');
});
test('localDateKey 是本地日期', () => {
  const ts = new Date(2026, 10, 25, 23, 30).getTime();
  assert.equal(localDateKey(ts), '2026-11-25');
  assert.ok(msUntilLocalMidnight(ts) > 0 && msUntilLocalMidnight(ts) <= HOUR);
});
test('配置默认值与范围收敛', () => {
  assert.equal(DEFAULTS.tokensPerPctFallback, 2000000);
  const cfg = sanitizeForTest({ reservePct: 999, windowHours: 0, historyDays: 5, autoRefreshSec: 1, timeZone: 'Asia/Shanghai' });
  assert.equal(cfg.reservePct, 50);
  assert.equal(cfg.windowHours, 1);
  assert.equal(cfg.historyDays, 5);
  assert.equal(cfg.autoRefreshSec, 5);
  assert.equal(cfg.timeZone, 'Asia/Shanghai');
  assert.equal(typeof publicConfig(cfg).reservePct, 'number');
});

console.log('\n[2] 窗口滚推（rollForward）');
test('重置时间在未来：直接用快照百分比', () => {
  const now = Date.now();
  const r = rollForward({ usedPct: 40, resetSec: Math.floor((now + 2 * DAY) / 1000), windowMs: WEEK, points: [], tokensPerPct: 1000, now });
  assert.equal(r.estimated, false);
  assert.equal(r.rollovers, 0);
  near(r.effectiveUsedPct, 40, 1e-9, 'usedPct');
  assert.ok(r.nextResetsAtMs > now);
});
test('重置时间已过：按重置后 token 消耗推定', () => {
  const now = 1795000000000;
  const resetSec = Math.floor((now - 2 * DAY) / 1000); // 2 天前就重置了
  const points = [
    { t: now - 1 * DAY, tk: 2000 },
    { t: now - 12 * HOUR, tk: 3000 },
    { t: now - 60 * HOUR, tk: 9999 }, // 早于重置（2 天前），不应计入
  ];
  const r = rollForward({ usedPct: 88, resetSec, windowMs: WEEK, points, tokensPerPct: 1000, now });
  assert.equal(r.rollovers, 1);
  assert.equal(r.estimated, true);
  near(r.effectiveUsedPct, 5, 1e-9, 'estimated used'); // 5000 tokens / 1000
  near(r.snapshotUsedPct, 88, 1e-9, 'snapshot');
  assert.ok(r.nextResetsAtMs > now);
  near(r.msLeft, r.nextResetsAtMs - now, 1e-6, 'msLeft');
});
test('跨多个周期也能正确滚推', () => {
  const now = 1795000000000;
  const resetSec = Math.floor((now - 15 * DAY) / 1000);
  const r = rollForward({ usedPct: 70, resetSec, windowMs: WEEK, points: [{ t: now - 60000, tk: 1500 }], tokensPerPct: 1000, now });
  assert.equal(r.rollovers, 3);
  near(r.effectiveUsedPct, 1.5, 1e-9, 'used');
});
test('推定值有上下限', () => {
  const now = 1795000000000;
  const resetSec = Math.floor((now - 1 * DAY) / 1000);
  const low = rollForward({ usedPct: 50, resetSec, windowMs: WEEK, points: [], tokensPerPct: 1e6, now });
  near(low.effectiveUsedPct, 0, 1e-9, '下限');
  const high = rollForward({ usedPct: 50, resetSec, windowMs: WEEK, points: [{ t: now - 1000, tk: 1e12 }], tokensPerPct: 1e3, now });
  near(high.effectiveUsedPct, 100, 1e-9, '上限');
});
test('windowBucket 按小时聚合同一窗口', () => {
  const reset = 1795511294;
  const a = windowBucket(reset, WEEK);
  const b = windowBucket(reset + 120, WEEK); // 抖动 2 分钟
  const c = windowBucket(reset + 7200, WEEK); // 抖 2 小时
  assert.equal(a, b);
  assert.notEqual(a, c);
});

console.log('\n[3] 指标与计划（合成数据）');
function syntheticPoints(now, tokensPerPct = 1000) {
  const resetSec = Math.floor((now + 3 * DAY) / 1000);
  const fiveResetSec = Math.floor((now + 3 * HOUR) / 1000);
  const points = [];
  for (let i = 24; i >= 0; i -= 1) {
    points.push({
      t: now - i * HOUR,
      tk: (tokensPerPct * 50) / 25, // 25 个点合计 = 50% 额度
      ip: 1000,
      cn: 800,
      op: 100,
      rs: 10,
      p5: 20,
      r5: fiveResetSec,
      pw: 30 + (25 - i),
      rw: resetSec,
    });
  }
  return points;
}
test('buildMetrics 产出完整的周/5 小时/今日结构', () => {
  const now = Date.now();
  const config = { ...DEFAULTS, timeZone: 'Asia/Shanghai' };
  const metrics = buildMetrics({ points: syntheticPoints(now), config, now, stats: { files: 1, points: 25, durationMs: 3 } });
  assert.ok(metrics.weekly, 'weekly');
  assert.ok(metrics.fiveHour, 'fiveHour');
  assert.equal(metrics.timeZone, 'Asia/Shanghai');
  assert.ok(metrics.weekly.remainingPct >= 0 && metrics.weekly.remainingPct <= 100);
  assert.ok(metrics.today.tokens > 0);
  assert.ok(metrics.days.length >= 2, 'days 补零');
  assert.ok(metrics.burn.avg7 >= 0);
  assert.equal(typeof metrics.snapshot.ageMs, 'number');
});
test('computePlan 的今日额度不超过周剩余', () => {
  const now = new Date(2026, 10, 25, 10, 0).getTime();
  const config = { ...DEFAULTS, timeZone: 'Asia/Shanghai', reservePct: 10 };
  const metrics = buildMetrics({ points: syntheticPoints(now), config, now, stats: { files: 1, points: 25, durationMs: 3 } });
  const plan = computePlan({ metrics, config, now });
  assert.ok(plan.todayAllowancePct > 0, '今日额度为正');
  assert.ok(plan.todayAllowancePct <= plan.usablePct + 1e-9, '今日额度 ≤ 可用额度');
  assert.ok(plan.dailyTokens > 0);
  assert.ok(plan.advice.length > 0);
  assert.ok(['live', 'estimated', 'history', 'none'].includes(plan.basis));
  const sum = plan.schedule.reduce((s, slot) => s + slot.tokens, 0);
  near(sum, plan.todayRemainingTokens, Math.max(2, plan.schedule.length), '时段合计');
});
test('无任何快照时退化为 history 模式而不是崩溃', () => {
  const now = Date.now();
  const config = { ...DEFAULTS };
  const metrics = buildMetrics({ points: [], config, now, stats: { files: 0, points: 0, durationMs: 1 } });
  const plan = computePlan({ metrics, config, now });
  assert.equal(plan.basis, 'none');
  assert.ok(plan.advice.length > 0);
  assert.ok(metrics.warnings.length > 0);
});

console.log('\n[4] 隔离样例日志端到端');
await testAsync('扫描样例 sessions 目录', async () => {
  const config = { ...DEFAULTS, scanBudgetMs: 120000 };
  const { points, stats } = await scanUsage({ config, now: Date.now() });
  assert.ok(points.length > 0, '解析到用量点');
  assert.ok(stats.files > 0, '发现会话文件');
  const metrics = buildMetrics({ points, config, now: Date.now(), stats });
  const plan = computePlan({ metrics, config, now: Date.now() });
  console.log(`     文件 ${stats.files} · 点 ${points.length} · 周剩余 ${metrics.weekly ? metrics.weekly.remainingPct.toFixed(1) + '%' : '无'} · 今日 ${fmtTokens(metrics.today.tokens)} · 建议 ${fmtTokens(plan.todayAllowanceTokens)} · 1%≈${fmtTokens(metrics.calibration.tokensPerPct)}`);
  assert.ok(metrics.data.newestAt <= Date.now() + 1000, '最新点不应在未来');
});

console.log('\n[5] MCP 协议（进程内直调 handle）');
const { handle, TOOLS } = await import('../plugins/codex-usage-coach/server/mcp-server.mjs');
const rpc = (id, method, params) => handle({ jsonrpc: '2.0', id, method, params });

await testAsync('initialize 返回工具能力与使用说明', async () => {
  const res = await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.equal(res.jsonrpc, '2.0');
  assert.equal(res.id, 1);
  assert.equal(res.result.serverInfo.name, 'codex-usage-coach');
  assert.equal(res.result.protocolVersion, '2025-06-18');
  assert.ok(res.result.capabilities.tools);
  assert.ok(res.result.instructions.length > 20);
});
await testAsync('notifications 不产生响应', async () => {
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'unknown/notification' }), null);
});
await testAsync('tools/list 结构完整', async () => {
  const res = await rpc(2, 'tools/list', {});
  const names = res.result.tools.map((t) => t.name);
  assert.deepEqual(names, ['usage_status', 'daily_plan', 'usage_history', 'write_usage_report', 'open_dashboard', 'show_dial', 'hide_dial', 'configure']);
  for (const tool of res.result.tools) {
    assert.ok(tool.description.length > 10, `${tool.name} 缺少描述`);
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.title, `${tool.name} 缺少 title`);
  }
  assert.equal(TOOLS.length, names.length);
});
await testAsync('ping / resources / prompts', async () => {
  assert.deepEqual((await rpc(3, 'ping', {})).result, {});
  assert.deepEqual((await rpc(4, 'resources/list', {})).result, { resources: [] });
  assert.deepEqual((await rpc(5, 'prompts/list', {})).result, { prompts: [] });
  const bad = await rpc(6, 'no/such/method', {});
  assert.equal(bad.error.code, -32601);
});
await testAsync('tools/call usage_status 返回卡片与结构化数据', async () => {
  const res = await rpc(7, 'tools/call', { name: 'usage_status', arguments: {} });
  assert.ok(!res.result.isError, `出错：${res.result?.content?.[0]?.text}`);
  const text = res.result.content[0].text;
  assert.ok(text.includes('Codex 用量'), '状态卡片标题');
  assert.ok(/周额度|暂无可用的额度快照/.test(text));
  const data = res.result.structuredContent;
  assert.ok(data.weekly, '结构化数据含 weekly');
  assert.ok(data.data.points >= 0);
  console.log(`     卡片首行：${text.split('\n')[0]}`);
  console.log(`     ${text.split('\n').slice(1, 3).join(' / ')}`);
});
await testAsync('tools/call daily_plan / usage_history / configure', async () => {
  const plan = await rpc(8, 'tools/call', { name: 'daily_plan', arguments: { reservePct: 15 } });
  assert.ok(!plan.result.isError, `daily_plan 出错：${plan.result?.content?.[0]?.text}`);
  assert.ok(plan.result.content[0].text.includes('今日额度'));
  assert.equal(plan.result.structuredContent.plan.reservePct, 15);

  const hist = await rpc(9, 'tools/call', { name: 'usage_history', arguments: { days: 5 } });
  assert.ok(!hist.result.isError, `usage_history 出错：${hist.result?.content?.[0]?.text}`);
  assert.ok(hist.result.structuredContent.days.length <= 5);

  const cfg = await rpc(10, 'tools/call', { name: 'configure', arguments: { historyDays: 9 } });
  assert.ok(!cfg.result.isError);
  assert.equal(cfg.result.structuredContent.config.historyDays, 9);
  assert.equal(cfg.result.structuredContent.changed, true);
  await rpc(11, 'tools/call', { name: 'configure', arguments: { historyDays: DEFAULTS.historyDays } });
});
await testAsync('tools/call 未知工具返回 isError 而不是崩溃', async () => {
  const res = await rpc(12, 'tools/call', { name: 'nope', arguments: {} });
  assert.equal(res.result.isError, true);
  assert.ok(res.result.content[0].text.includes('未知工具'));
});
await testAsync('仪表盘与报告文件能写出来', async () => {
  const { locations } = await import('../plugins/codex-usage-coach/server/lib/paths.mjs');
  const fs = await import('node:fs');
  const dash = await rpc(13, 'tools/call', { name: 'open_dashboard', arguments: { serve: false, open: false } });
  assert.ok(!dash.result.isError, `open_dashboard 出错：${dash.result?.content?.[0]?.text}`);
  const html = fs.readFileSync(locations.dashboard(), 'utf8');
  assert.ok(html.includes('Codex 用量管家'));
  assert.ok(html.includes('<svg'), '含环形图');
  assert.ok(fs.existsSync(locations.dashboardData()), '含数据快照 json');

  const out = path.join(testHome, 'test-report.md');
  const report = await rpc(14, 'tools/call', { name: 'write_usage_report', arguments: { days: 7, outPath: out } });
  assert.ok(!report.result.isError, `write_usage_report 出错：${report.result?.content?.[0]?.text}`);
  const md = fs.readFileSync(out, 'utf8');
  assert.ok(md.startsWith('# Codex 用量报告'));
  assert.ok(md.includes('## 今日计划'));
  console.log(`     仪表盘 ${html.length} 字节 · 报告 ${md.length} 字符`);
});

console.log('\n[6] 悬浮表盘数据契约');
const { dialState } = await import('../plugins/codex-usage-coach/server/lib/dial.mjs');
test('三个环的数值来自周/今日计划', () => {
  const now = new Date(2026, 10, 25, 10, 0).getTime();
  const config = { ...DEFAULTS, timeZone: 'Asia/Shanghai', reservePct: 10 };
  const metrics = buildMetrics({ points: syntheticPoints(now), config, now, stats: { files: 1, points: 25, durationMs: 3 } });
  const plan = computePlan({ metrics, config, now });
  const d = dialState({ metrics, plan, account: { plan: 'plus', email: 'demo@example.com' }, config });
  assert.equal(d.version, 1);
  assert.ok(/%$/.test(d.rings.weekly.value), '周环显示百分比');
  near(parseFloat(d.rings.weekly.value), metrics.weekly.remainingPct, 0.11, '周环百分比文本');
  near(d.rings.weekly.pct, metrics.weekly.remainingPct, 1e-6, '周环百分比');
  near(d.rings.today.pct, (plan.todayRemainingTokens / plan.todayAllowanceTokens) * 100, 0.5, '今日环百分比');
  assert.ok(d.rings.budget.pct >= 0 && d.rings.budget.pct <= 100);
  assert.ok(d.headline.value.length > 0 && d.headline.value !== '0', '今日可用有值');
  assert.ok(d.account.includes('Plus') && !d.account.includes('demo@'), '账号脱敏');
  assert.ok(d.weekly.resetsText.length > 0 && d.fiveHour.resetsText.length > 0, '重置时间');
  assert.ok(d.updatedText.match(/^\d{2}:\d{2}$/), '更新时间格式');
});
test('完全没有数据时显示 — 而不是 0', () => {
  const now = Date.now();
  const config = { ...DEFAULTS };
  const metrics = buildMetrics({ points: [], config, now, stats: { files: 0, points: 0, durationMs: 1 } });
  const plan = computePlan({ metrics, config, now });
  const d = dialState({ metrics, plan, account: null, config });
  assert.equal(d.basis, 'none');
  assert.equal(d.rings.weekly.value, '—');
  assert.equal(d.rings.today.value, '—');
  assert.equal(d.rings.budget.value, '—');
  assert.equal(d.headline.value, '—');
  assert.ok(d.warnings.some((w) => w.includes('还没有读到任何用量数据')), '给出无数据提示');
});

console.log(`\n${failures.length ? '❌' : '✅'} 通过 ${passed} 项${failures.length ? `，失败 ${failures.length} 项` : ''}\n`);
if (failures.length) {
  for (const f of failures) console.error(`- ${f.name}: ${f.err.stack || f.err.message}`);
  process.exit(1);
}
