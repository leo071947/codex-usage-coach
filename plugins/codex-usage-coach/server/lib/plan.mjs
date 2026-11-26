// 预算规划：把"剩余额度 + 剩余时间 + 历史消耗"换算成今天还能用多少、每 5 小时一批怎么分。
import { fmtTokens, msUntilLocalMidnight } from './util.mjs';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const PACE = {
  over: { status: 'over', label: '用得太快', icon: '🔴', color: '#ef4444' },
  tight: { status: 'tight', label: '略快于计划', icon: '🟠', color: '#f59e0b' },
  ok: { status: 'ok', label: '节奏正常', icon: '🟢', color: '#22c55e' },
  roomy: { status: 'roomy', label: '还有余量', icon: '🔵', color: '#3b82f6' },
  unknown: { status: 'unknown', label: '数据不足', icon: '⚪', color: '#64748b' },
};

function paceOf(usedPct, expectedPct) {
  if (!Number.isFinite(usedPct) || !Number.isFinite(expectedPct)) return { ...PACE.unknown, deltaPct: null };
  const deltaPct = usedPct - expectedPct;
  let base;
  if (deltaPct > 10) base = PACE.over;
  else if (deltaPct > 3) base = PACE.tight;
  else if (deltaPct >= -10) base = PACE.ok;
  else base = PACE.roomy;
  return { ...base, deltaPct };
}

/**
 * @param {{metrics: object, config: object, now?: number}} args
 */
export function computePlan({ metrics, config = {}, now = Date.now() } = {}) {
  const reservePct = clamp(Number(config.reservePct ?? 10), 0, 50);
  const windowHours = clamp(Number(config.windowHours ?? 5), 1, 24);
  const weekly = metrics.weekly;
  const tokensPerPct = metrics.calibration?.tokensPerPct || Number(config.tokensPerPctFallback) || 0;
  const warnings = [...(metrics.warnings || [])];
  const advice = [];

  const result = {
    generatedAt: now,
    timeZone: metrics.timeZone,
    basis: 'none',
    tokensPerPct,
    reservePct,
    windowHours,
    weeklyRemainingPct: null,
    weeklyRemainingTokens: null,
    dailyPct: null,
    dailyTokens: null,
    todayAllowancePct: null,
    todayAllowanceTokens: null,
    todayUsedPct: null,
    todayUsedTokens: 0,
    todayRemainingPct: null,
    todayRemainingTokens: null,
    todayProgress: null,
    expectedTodayPct: null,
    expectedTodayTokens: null,
    turnsLeft: null,
    fiveHour: null,
    schedule: [],
    weeklyPace: { ...PACE.unknown, deltaPct: null },
    todayPace: { ...PACE.unknown, deltaPct: null },
    advice,
    warnings,
  };

  if (!weekly || !Number.isFinite(weekly.remainingPct)) {
    // 没有额度快照：退化为"按历史节奏建议"
    const baseline = metrics.burn?.avg7 || metrics.burn?.avg14 || 0;
    const capped = config.dailyTokenCap > 0 ? Math.min(baseline, config.dailyTokenCap) : baseline;
    result.basis = capped > 0 ? 'history' : 'none';
    result.dailyTokens = Math.round(capped * (1 - reservePct / 100));
    result.dailyPct = tokensPerPct > 0 ? result.dailyTokens / tokensPerPct : null;
    result.todayUsedTokens = metrics.today?.windowTokens ?? metrics.today?.tokens ?? 0;
    result.todayUsedPct = tokensPerPct > 0 ? result.todayUsedTokens / tokensPerPct : null;
    result.todayRemainingTokens = Math.max(0, result.dailyTokens - result.todayUsedTokens);
    result.todayRemainingPct = tokensPerPct > 0 ? result.todayRemainingTokens / tokensPerPct : null;
    const daySpan = clamp(24 - msUntilLocalMidnight(now, metrics.timeZone) / 3600000, 0, 24);
    result.todayProgress = daySpan / 24;
    result.expectedTodayPct = (result.dailyPct || 0) * result.todayProgress;
    result.expectedTodayTokens = Math.round(result.expectedTodayPct * tokensPerPct);
    result.todayPace = paceOf(result.todayUsedPct, result.expectedTodayPct);
    result.turnsLeft = metrics.burn?.tokensPerTurn > 0 ? Math.floor(result.todayRemainingTokens / metrics.burn.tokensPerTurn) : null;
    if (result.basis === 'none') {
      warnings.push('目前既没有额度快照也没有历史消耗，无法给出建议用量。先用 Codex 聊几轮再试。');
    } else {
      warnings.push('没有可用的额度快照，今日建议按最近 7 天日均消耗推算（估算值）。');
    }
    advice.push('打开 Codex 正常使用几轮后，日志里会出现 rate_limits 快照，届时建议会切换成按真实剩余额度计算。');
    result.advice = advice.slice(0, 6);
    return result;
  }

  result.basis = weekly.estimated ? 'estimated' : 'live';
  result.weeklyRemainingPct = weekly.remainingPct;
  result.weeklyRemainingTokens = weekly.remainingPct * tokensPerPct;
  result.weeklyPace = paceOf(weekly.usedPct, weekly.expectedPct);
  result.weeklyResetsAtMs = weekly.nextResetsAtMs;
  result.weeklyMsLeft = weekly.msLeft;

  // 今日可分配 = 可用余额 × (今天剩余时间 / 整个剩余窗口)
  const usablePct = weekly.remainingPct * (1 - reservePct / 100);
  const msLeft = Math.max(0, weekly.msLeft);
  const hoursLeft = msLeft / 3600000;
  const hoursToday = Math.min(hoursLeft, msUntilLocalMidnight(now, metrics.timeZone) / 3600000);
  const todayAllowancePct = hoursLeft > 0 ? usablePct * (hoursToday / hoursLeft) : 0;
  const dailyPct = hoursLeft > 0 ? usablePct / (hoursLeft / 24) : 0;

  result.usablePct = usablePct;
  result.daysLeft = hoursLeft / 24;
  result.dailyPct = dailyPct;
  result.dailyTokens = Math.round(dailyPct * tokensPerPct);
  result.todayAllowancePct = todayAllowancePct;
  result.todayAllowanceTokens = Math.round(todayAllowancePct * tokensPerPct);
  result.todayUsedTokens = metrics.today?.windowTokens ?? 0;
  result.todayUsedPct = tokensPerPct > 0 ? result.todayUsedTokens / tokensPerPct : null;
  result.todayRemainingPct = Math.max(0, todayAllowancePct - (result.todayUsedPct || 0));
  result.todayRemainingTokens = Math.round(result.todayRemainingPct * tokensPerPct);
  // 今日进度：拿"今天已过去的时长占比"去和"日均额度"比，判断今天是不是用超/用少了
  const daySpanHours = clamp(24 - hoursToday, 0, 24);
  result.todayProgress = daySpanHours / 24;
  result.expectedTodayPct = dailyPct * result.todayProgress;
  result.expectedTodayTokens = Math.round(result.expectedTodayPct * tokensPerPct);
  result.todayPace = paceOf(result.todayUsedPct, result.expectedTodayPct);
  result.turnsLeft =
    metrics.burn?.tokensPerTurn > 0 ? Math.floor(result.todayRemainingTokens / metrics.burn.tokensPerTurn) : null;

  if (config.dailyTokenCap > 0 && result.dailyTokens > config.dailyTokenCap) {
    const scaled = config.dailyTokenCap;
    const factor = result.dailyTokens > 0 ? scaled / result.dailyTokens : 0;
    result.dailyTokens = scaled;
    result.todayAllowanceTokens = Math.round(result.todayAllowanceTokens * factor);
    result.todayRemainingTokens = Math.max(0, result.todayAllowanceTokens - result.todayUsedTokens);
    result.todayRemainingPct = tokensPerPct > 0 ? result.todayRemainingTokens / tokensPerPct : null;
    advice.push(`已套用你设置的单日上限 ${fmtTokens(config.dailyTokenCap)} tokens。`);
  }

  // ---- 5 小时窗口 ----
  if (metrics.fiveHour) {
    const fh = metrics.fiveHour;
    result.fiveHour = {
      remainingPct: fh.remainingPct,
      remainingTokens: Math.round(fh.remainingPct * (tokensPerPct / 33.6)),
      usedPct: fh.usedPct,
      expectedPct: fh.expectedPct,
      resetsAtMs: fh.nextResetsAtMs,
      msLeft: fh.msLeft,
      estimated: fh.estimated,
      pace: paceOf(fh.usedPct, fh.expectedPct),
    };
  }

  // ---- 今日剩余时段配额表 ----
  const slots = Math.max(1, Math.ceil(hoursToday / windowHours));
  const perSlotPct = result.todayRemainingPct / slots;
  let cursor = now;
  const endOfDay = now + msUntilLocalMidnight(now, metrics.timeZone);
  for (let i = 0; i < slots; i += 1) {
    const slotEnd = Math.min(endOfDay, cursor + windowHours * 3600000);
    result.schedule.push({
      index: i + 1,
      startMs: cursor,
      endMs: slotEnd,
      pct: perSlotPct,
      tokens: Math.round(perSlotPct * tokensPerPct),
    });
    cursor = slotEnd;
  }

  // ---- 建议文案 ----
  const pace = result.weeklyPace;
  if (pace.status === 'over') {
    advice.push(
      `本周额度消耗比匀速进度快 ${pace.deltaPct.toFixed(1)} 个百分点（应到 ${weekly.expectedPct.toFixed(0)}%，实际 ${weekly.usedPct.toFixed(0)}%），建议立刻收紧：先做小而明确的任务。`,
    );
  } else if (pace.status === 'tight') {
    advice.push(`节奏略快（快 ${pace.deltaPct.toFixed(1)} 个百分点），今天别开长上下文大重构。`);
  } else if (pace.status === 'roomy') {
    advice.push(`比匀速进度慢 ${Math.abs(pace.deltaPct).toFixed(1)} 个百分点，还有余量，可以安排一次较大的任务。`);
  } else if (pace.status === 'ok') {
    advice.push('消耗节奏和剩余时间基本同步，保持现在的用法即可。');
  }

  if (weekly.remainingPct <= 10) {
    advice.push(`本周只剩 ${weekly.remainingPct.toFixed(1)}% 额度（≈${fmtTokens(result.weeklyRemainingTokens)} tokens），优先留给必须完成的事。`);
  }

  if (result.todayRemainingTokens <= 0) {
    advice.push('今天的建议配额已经用完，继续用会透支本周余额；建议把手上的活留到明天或只做小改动。');
  } else {
    const turnsText = result.turnsLeft != null && result.turnsLeft > 0 ? `，约 ${result.turnsLeft} 次中等任务` : '';
    advice.push(`今天剩余时段建议再消耗 ≤ ${fmtTokens(result.todayRemainingTokens)} tokens（≈${result.todayRemainingPct.toFixed(1)}% 周额度${turnsText}）。`);
  }

  if (result.fiveHour && result.fiveHour.remainingPct < 25) {
    advice.push(
      `当前 5 小时窗口只剩 ${result.fiveHour.remainingPct.toFixed(1)}%，重置后再开大任务更划算（窗口重置时间见上）。`,
    );
  }

  if (reservePct > 0) {
    advice.push(`已为你预留 ${reservePct}% 周额度作为应急缓冲（可在配置里调整 reservePct）。`);
  }

  result.advice = advice.slice(0, 6);
  return result;
}
