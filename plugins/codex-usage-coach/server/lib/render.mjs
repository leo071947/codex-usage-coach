// 文本渲染：给聊天窗口的卡片、历史表、Markdown 报告
import { maskEmail, planLabel } from './account.mjs';
import {
  bar,
  displayWidth,
  fmtDateTime,
  fmtDur,
  fmtInt,
  fmtPct,
  fmtShortDateTime,
  fmtTokens,
  padEnd,
} from './util.mjs';

const LINE = '─'.repeat(46);

/** 按文本去重并保持顺序（metrics 与 plan 的 warnings 有重叠） */
function uniqText(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const text = String(item ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function healthIcon(metrics) {
  if (!metrics.snapshot) return '⚪';
  const f = metrics.snapshot.freshness;
  if (!f) return '⚪';
  return f.icon;
}

function snapshotAgeText(metrics) {
  const snap = metrics.snapshot;
  if (!snap) return '无额度快照';
  return `${fmtDateTime(snap.t, metrics.timeZone)}（${fmtDur(snap.ageMs)}前 · ${snap.freshness?.label ?? '未知'}）`;
}

function resetText(ms, timeZone, now) {
  if (!Number.isFinite(ms)) return '未知';
  const rel = ms >= now ? `${fmtDur(ms - now)}后` : `已过去 ${fmtDur(now - ms)}`;
  return `${fmtDateTime(ms, timeZone)}（${rel}）`;
}

export function accountHeadline(account) {
  const parts = [];
  const plan = planLabel(account?.plan);
  if (plan) parts.push(plan);
  const mail = maskEmail(account?.email);
  if (mail) parts.push(mail);
  return parts.join(' · ');
}

/** 主卡片：剩余额度 + 更新时间 */
export function statusCard({ metrics, plan, account }) {
  const now = metrics.generatedAt;
  const tz = metrics.timeZone;
  const lines = [];
  const head = accountHeadline(account);
  lines.push(`${healthIcon(metrics)} Codex 用量${head ? ' · ' + head : ''}`);
  lines.push(`更新 ${fmtDateTime(now, tz)}（本次查询）`);
  lines.push(`快照 ${snapshotAgeText(metrics)}`);
  lines.push(LINE);

  const w = metrics.weekly;
  if (w) {
    lines.push(`周额度  ${bar(w.usedPct, 28)} ${fmtPct(w.usedPct)} 已用`);
    lines.push(
      `        剩余 ${fmtPct(w.remainingPct)}${w.remainingTokens ? ` ≈ ${fmtTokens(w.remainingTokens)} tokens` : ''}` +
        (w.estimated ? '（推定）' : ''),
    );
    lines.push(`        重置 ${resetText(w.nextResetsAtMs, tz, now)}`);
    if (w.estimated) {
      lines.push(
        `        ⚠ 快照读数 ${fmtPct(w.snapshotUsedPct)} 属于 ${fmtDateTime(w.snapshotResetsAtMs - 7 * 86400000, tz)} 开始的窗口，已重置；现值按期间的 token 消耗推定`,
      );
    }
    if (Number.isFinite(w.pacePct)) {
      const dir = w.pacePct >= 0 ? '快' : '慢';
      lines.push(`        进度 应到 ${fmtPct(w.expectedPct, 0)}，实际 ${fmtPct(w.usedPct, 0)}（${dir} ${Math.abs(w.pacePct).toFixed(1)} 个百分点）`);
    }
  } else {
    lines.push('周额度  暂无可用的额度快照（会话日志里还没有 rate_limits 信息）');
  }

  lines.push('');
  const fh = metrics.fiveHour;
  if (fh) {
    lines.push(`5 小时  ${bar(fh.usedPct, 28)} ${fmtPct(fh.usedPct)} 已用`);
    lines.push(`        剩余 ${fmtPct(fh.remainingPct)}${fh.remainingTokens ? ` ≈ ${fmtTokens(fh.remainingTokens)} tokens` : ''}`);
    lines.push(`        重置 ${resetText(fh.nextResetsAtMs, tz, now)}`);
  } else {
    lines.push('5 小时  无窗口快照');
  }

  lines.push('');
  const today = metrics.today;
  lines.push(`今日    ${fmtTokens(today.tokens)} tokens · ${fmtInt(today.turns)} 轮` + (today.cacheRatio ? ` · 缓存命中 ${fmtPct(today.cacheRatio * 100, 0)}` : ''));
  if (plan?.todayRemainingTokens != null) {
    lines.push(`        今日建议再消耗 ≤ ${fmtTokens(plan.todayRemainingTokens)} tokens（≈${fmtPct(plan.todayRemainingPct ?? 0)} 周额度）`);
  }
  if (plan?.weeklyPace?.deltaPct != null) {
    lines.push(`节奏    ${plan.weeklyPace.icon} ${plan.weeklyPace.label}（${plan.weeklyPace.deltaPct >= 0 ? '+' : ''}${plan.weeklyPace.deltaPct.toFixed(1)} 个百分点）`);
  }
  if (metrics.calibration?.method === 'window') {
    lines.push(`换算    1% 周额度 ≈ ${fmtTokens(metrics.calibration.tokensPerPct)} tokens（${metrics.calibration.samples} 个采样点）`);
  } else {
    lines.push(`换算    1% 周额度 ≈ ${fmtTokens(metrics.calibration?.tokensPerPct)} tokens（默认估值，样本不足）`);
  }
  const cardWarnings = uniqText(metrics.warnings).filter(
    (warn) => !(w && w.estimated && warn.includes('额度快照已过期')),
  );
  for (const warn of cardWarnings.slice(0, 2)) lines.push(`⚠ ${warn}`);
  return lines.join('\n');
}

/** 每日预算卡 */
export function planCard({ metrics, plan }) {
  const tz = metrics.timeZone;
  const now = metrics.generatedAt;
  const lines = [];
  lines.push(`📅 用量计划 · ${fmtDateTime(now, tz).slice(0, 10)}`);
  lines.push(LINE);
  if (plan.basis === 'none') {
    lines.push('暂时算不出建议用量：还没有额度快照和历史消耗。');
    for (const warn of plan.warnings) lines.push(`⚠ ${warn}`);
    return lines.join('\n');
  }

  if (plan.weeklyRemainingPct != null) {
    lines.push(`本周剩余  ${fmtPct(plan.weeklyRemainingPct)} ≈ ${fmtTokens(plan.weeklyRemainingTokens)} tokens`);
    lines.push(`重置时间  ${resetText(plan.weeklyResetsAtMs, tz, now)}`);
    lines.push(`预留缓冲  ${fmtPct(plan.reservePct)}（应急用，不参与分配）`);
    lines.push(`日均额度  ${fmtPct(plan.dailyPct)} ≈ ${fmtTokens(plan.dailyTokens)} tokens/天`);
  } else {
    lines.push(`本周剩余  未知（按最近 7 天日均 ${fmtTokens(metrics.burn.avg7)} tokens 推算）`);
    lines.push(`日均额度  ${fmtTokens(plan.dailyTokens)} tokens/天（估算）`);
  }
  lines.push(LINE);
  lines.push(`今日额度  ${fmtTokens(plan.todayAllowanceTokens)} tokens`);
  lines.push(`已用      ${fmtTokens(plan.todayUsedTokens)} tokens（${fmtPct(plan.todayUsedPct ?? 0, 1)} 周额度）`);
  lines.push(`还能用    ${fmtTokens(plan.todayRemainingTokens)} tokens` + (plan.turnsLeft ? ` ≈ ${plan.turnsLeft} 次中等任务` : ''));
  if (plan.todayPace?.deltaPct != null) {
    lines.push(`今日节奏  ${plan.todayPace.icon} ${plan.todayPace.label}`);
  }
  if (plan.fiveHour) {
    lines.push(
      `5 小时内 还剩 ${fmtPct(plan.fiveHour.remainingPct)} ≈ ${fmtTokens(plan.fiveHour.remainingTokens)} tokens（${fmtShortDateTime(plan.fiveHour.resetsAtMs, tz)} 重置）`,
    );
  }

  if (plan.schedule.length) {
    lines.push('');
    lines.push(`剩余时段分配（每批约 ${plan.windowHours} 小时）`);
    for (const slot of plan.schedule) {
      const range = `${fmtShortDateTime(slot.startMs, tz)}–${fmtShortDateTime(slot.endMs, tz).slice(6)}`;
      lines.push(`  ${padEnd(range, 20)} ${padEnd(fmtTokens(slot.tokens), 8)} ${fmtPct(slot.pct)}`);
    }
  }

  if (plan.advice.length) {
    lines.push('');
    lines.push('建议');
    for (const item of plan.advice) lines.push(`· ${item}`);
  }
  for (const warn of plan.warnings) lines.push(`⚠ ${warn}`);
  return lines.join('\n');
}

/** 历史消耗表 */
export function historyTable({ metrics, plan }) {
  const tz = metrics.timeZone;
  const span = Math.max(1, plan?.historyDays ?? metrics.series.length);
  const days = (metrics.series?.length ? metrics.series : metrics.days).slice(-span);
  const lines = [];
  if (!days.length) return '还没有任何用量记录。';
  const max = Math.max(...days.map((d) => d.tokens), 1);
  const avg7 = metrics.burn.avg7 || 0;
  const withData = days.filter((d) => d.turns > 0).length;
  lines.push(
    `近 ${days.length} 天消耗（有记录的 ${withData} 天 · 合计 ${fmtTokens(days.reduce((s, d) => s + d.tokens, 0))} tokens · ${fmtInt(days.reduce((s, d) => s + d.turns, 0))} 轮）`,
  );
  lines.push('日期        用量      轮次   缓存   相对日均');
  for (const d of days) {
    if (!d.turns) {
      lines.push(`${d.date}  ${padEnd('—', 8)}  ${padEnd('—', 5)}  ${padEnd('—', 5)}  ${padEnd('—', 6)} ${bar(0, 10)}`);
      continue;
    }
    const ratio = avg7 > 0 ? d.tokens / avg7 : 0;
    const barPct = (d.tokens / max) * 100;
    lines.push(
      `${d.date}  ${padEnd(fmtTokens(d.tokens), 8)}  ${padEnd(String(d.turns), 5)}  ${padEnd(fmtPct((d.cacheRatio || 0) * 100, 0), 5)}  ${padEnd(String(ratio.toFixed(2)) + '×', 6)} ${bar(barPct, 10)}`,
    );
  }
  lines.push('');
  lines.push(`日均（近 7 天） ${fmtTokens(metrics.burn.avg7)} tokens · 峰值 ${metrics.burn.peak ? `${metrics.burn.peak.date} ${fmtTokens(metrics.burn.peak.tokens)}` : '—'}`);
  lines.push(`数据范围 ${fmtDateTime(metrics.data.oldestAt ?? metrics.generatedAt, tz).slice(0, 10)} ~ ${fmtDateTime(metrics.data.newestAt ?? metrics.generatedAt, tz).slice(0, 10)} · ${fmtInt(metrics.data.points)} 个用量点 · ${metrics.data.files ?? '?'} 个会话文件`);
  if (metrics.data.partial) lines.push('⚠ 本次扫描时间用完，还有文件没读完；下次调用会继续。');
  return lines.join('\n');
}

/** Markdown 报告 */
export function reportMarkdown({ metrics, plan, account, generatedAt = metrics.generatedAt }) {
  const tz = metrics.timeZone;
  const head = accountHeadline(account);
  const out = [];
  out.push('# Codex 用量报告');
  out.push('');
  out.push(`- 生成时间：${fmtDateTime(generatedAt, tz)}（${tz}）`);
  out.push(`- 账号：${head || '未知'}`);
  out.push(`- 数据快照：${snapshotAgeText(metrics)}`);
  out.push(`- 数据规模：${fmtInt(metrics.data.points)} 个用量点 / ${metrics.data.files ?? '?'} 个会话文件，最早 ${fmtDateTime(metrics.data.oldestAt ?? generatedAt, tz)}`);
  out.push('');
  out.push('## 额度');
  out.push('');
  out.push('| 项目 | 数值 |');
  out.push('| --- | --- |');
  if (metrics.weekly) {
    out.push(`| 周额度已用 | ${fmtPct(metrics.weekly.usedPct)}${metrics.weekly.estimated ? '（推定）' : ''} |`);
    out.push(`| 周额度剩余 | ${fmtPct(metrics.weekly.remainingPct)} ≈ ${fmtTokens(metrics.weekly.remainingTokens)} tokens |`);
    out.push(`| 周额度重置 | ${resetText(metrics.weekly.nextResetsAtMs, tz, generatedAt)} |`);
  } else {
    out.push('| 周额度 | 无快照 |');
  }
  if (metrics.fiveHour) {
    out.push(`| 5 小时窗已用 | ${fmtPct(metrics.fiveHour.usedPct)}${metrics.fiveHour.estimated ? '（推定）' : ''} |`);
    out.push(`| 5 小时窗剩余 | ${fmtPct(metrics.fiveHour.remainingPct)} ≈ ${fmtTokens(metrics.fiveHour.remainingTokens)} tokens |`);
    out.push(`| 5 小时窗重置 | ${resetText(metrics.fiveHour.nextResetsAtMs, tz, generatedAt)} |`);
  }
  out.push(`| 换算关系 | 1% 周额度 ≈ ${fmtTokens(metrics.calibration?.tokensPerPct)} tokens（${metrics.calibration?.method === 'window' ? metrics.calibration.samples + ' 个采样点' : '默认估值'}） |`);
  out.push('');
  out.push('## 今日计划');
  out.push('');
  if (plan.basis === 'none') {
    out.push('> 数据不足，暂时无法给出建议。');
  } else {
    out.push('| 项目 | 数值 |');
    out.push('| --- | --- |');
    out.push(`| 今日额度 | ${fmtTokens(plan.todayAllowanceTokens)} tokens |`);
    out.push(`| 今日已用 | ${fmtTokens(plan.todayUsedTokens)} tokens |`);
    out.push(`| 今日还能用 | ${fmtTokens(plan.todayRemainingTokens)} tokens${plan.turnsLeft ? `（≈${plan.turnsLeft} 次中等任务）` : ''} |`);
    if (plan.dailyTokens) out.push(`| 日均建议 | ${fmtTokens(plan.dailyTokens)} tokens/天（预留 ${fmtPct(plan.reservePct)} 缓冲后） |`);
    if (plan.schedule.length) {
      out.push('');
      out.push('| 时段 | 建议配额 |');
      out.push('| --- | --- |');
      for (const slot of plan.schedule) {
        out.push(`| ${fmtShortDateTime(slot.startMs, tz)} – ${fmtShortDateTime(slot.endMs, tz).slice(6)} | ${fmtTokens(slot.tokens)} tokens（${fmtPct(slot.pct)}） |`);
      }
    }
    out.push('');
    out.push('## 建议');
    out.push('');
    for (const item of plan.advice) out.push(`- ${item}`);
  }
  const allWarnings = uniqText([...(metrics.warnings || []), ...(plan.warnings || [])]);
  if (allWarnings.length) {
    out.push('');
    out.push('## 数据提示');
    out.push('');
    for (const warn of allWarnings) out.push(`- ${warn}`);
  }
  out.push('');
  out.push('## 历史消耗');
  out.push('');
  const days = (metrics.series?.length ? metrics.series : metrics.days).slice(-14);
  if (days.length) {
    out.push('| 日期 | 用量 | 轮次 | 缓存命中 |');
    out.push('| --- | --- | --- | --- |');
    for (const d of days) {
      if (!d.turns) {
        out.push(`| ${d.date} | — | — | — |`);
        continue;
      }
      out.push(`| ${d.date} | ${fmtTokens(d.tokens)} | ${fmtInt(d.turns)} | ${fmtPct((d.cacheRatio || 0) * 100, 0)} |`);
    }
    out.push('');
  } else {
    out.push('暂无记录。');
    out.push('');
  }
  out.push('---');
  out.push('');
  out.push('数据来自本机 `~/.codex/sessions` 下的会话日志（离线解析，不上传）。额度百分比来自日志里的 `rate_limits` 快照；若快照已过期，剩余量会按 token 消耗推定并标注。');
  return out.join('\n');
}
