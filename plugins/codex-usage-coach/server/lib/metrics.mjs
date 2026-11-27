// 把原始用量点（points）整理成可展示的事实：额度快照、窗口推移、每日消耗、标定系数。
import { fmtDateTime, freshness, localDateKey, msUntilLocalMidnight, resolveTimeZone } from './util.mjs';

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const FIVE_H_MS = 5 * 60 * 60 * 1000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sum = (arr, pick) => arr.reduce((acc, item) => acc + (pick(item) || 0), 0);

/** 把 reset 秒级时间戳折算成"窗口开始时间"的小时桶，容忍服务器给的毫秒抖动 */
export function windowBucket(resetSec, windowMs) {
  return Math.round((resetSec * 1000 - windowMs) / 3600000);
}

/** 找出最近一次带额度信息的点 */
export function latestSnapshot(points) {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i];
    if (isNum(p.pw) || isNum(p.p5)) return p;
  }
  return null;
}

/**
 * 把"快照时刻的 used%"推进到"现在"：
 * 若 now 已越过 resets_at，说明额度窗口又重置了若干次，用两点之间的 token 消耗回推当前已用量。
 */
export function rollForward({ usedPct, resetSec, windowMs, points, tokensPerPct, now }) {
  const base = {
    snapshotUsedPct: usedPct,
    snapshotResetsAtMs: resetSec * 1000,
    rollovers: 0,
    estimated: false,
    effectiveUsedPct: usedPct,
    nextResetsAtMs: resetSec * 1000,
    msLeft: resetSec * 1000 - now,
    elapsedMs: 0,
  };
  if (!isNum(usedPct) || !isNum(resetSec)) return base;
  const resetMs = resetSec * 1000;
  if (now < resetMs) {
    base.elapsedMs = windowMs - (resetMs - now);
    return base;
  }
  // 快照所属窗口已经结束：按 token 消耗推算当前窗口已用
  const rollovers = Math.floor((now - resetMs) / windowMs) + 1;
  const currentStart = resetMs + (rollovers - 1) * windowMs;
  const nextReset = currentStart + windowMs;
  const tokensSince = sum(
    points.filter((p) => p.t >= currentStart && p.t <= now),
    (p) => p.tk,
  );
  const estimatedUsed = tokensPerPct > 0 ? clamp(tokensSince / tokensPerPct, 0, 100) : 0;
  return {
    snapshotUsedPct: usedPct,
    snapshotResetsAtMs: resetMs,
    rollovers,
    estimated: true,
    effectiveUsedPct: estimatedUsed,
    estimatedFromTokens: tokensSince,
    nextResetsAtMs: nextReset,
    msLeft: nextReset - now,
    elapsedMs: now - currentStart,
  };
}

/** 5 小时 / 每周两档额度的标定：一个窗口内 token 消耗 / used% 增量 */
function calibrateRatio(points, snapshot, windowMs, fallback) {
  const empty = { tokensPerPct: fallback, samples: 0, method: 'fallback', windowTokens: 0, windowPct: 0 };
  if (!snapshot || !isNum(snapshot.pw) || !isNum(snapshot.rw)) return empty;
  const key = windowBucket(snapshot.rw, windowMs);
  const inWindow = points.filter(
    (p) => isNum(p.pw) && isNum(p.rw) && windowBucket(p.rw, windowMs) === key,
  );
  if (inWindow.length < 3) return empty;
  const dpw = inWindow[inWindow.length - 1].pw - inWindow[0].pw;
  if (dpw < 5) return empty;
  const tokens = sum(inWindow, (p) => p.tk);
  const ratio = clamp(tokens / dpw, 10000, 50000000);
  return {
    tokensPerPct: Math.round(ratio / 1000) * 1000,
    samples: inWindow.length,
    method: 'window',
    windowTokens: tokens,
    windowPct: dpw,
  };
}

function aggregateDays(points, timeZone) {
  const map = new Map();
  for (const p of points) {
    const key = localDateKey(p.t, timeZone);
    let day = map.get(key);
    if (!day) {
      day = { date: key, tokens: 0, turns: 0, cached: 0, output: 0, reasoning: 0, firstAt: p.t, lastAt: p.t };
      map.set(key, day);
    }
    day.tokens += p.tk;
    day.turns += 1;
    day.cached += p.cn;
    day.output += p.op;
    day.reasoning += p.rs;
    day.lastAt = p.t;
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

function buildDaySeries(days, now, timeZone, span) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const out = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const key = localDateKey(now - i * 86400000, timeZone);
    const day = byDate.get(key);
    out.push(
      day
        ? { ...day, cacheRatio: day.tokens > 0 ? day.cached / day.tokens : 0 }
        : { date: key, tokens: 0, turns: 0, cached: 0, output: 0, reasoning: 0, cacheRatio: 0, firstAt: null, lastAt: null },
    );
  }
  return out;
}

/**
 * 主入口：把 points 变成展示/决策所需的事实集合。
 */
export function buildMetrics({ points, config = {}, now = Date.now(), stats = {}, quotaSnapshot = null } = {}) {
  const timeZone = resolveTimeZone(config.timeZone);
  const fallback = Number(config.tokensPerPctFallback) || 2000000;
  const snapshot = quotaSnapshot ?? latestSnapshot(points);
  const warnings = [];

  const calibration = calibrateRatio(points, snapshot, WEEK_MS, fallback);
  const tokensPerPct = calibration.tokensPerPct;

  // ---- 每周额度 ----
  let weekly = null;
  if (snapshot && isNum(snapshot.pw) && isNum(snapshot.rw)) {
    const roll = rollForward({
      usedPct: snapshot.pw,
      resetSec: snapshot.rw,
      windowMs: WEEK_MS,
      points,
      tokensPerPct,
      now,
    });
    const elapsedFrac = clamp(roll.elapsedMs / WEEK_MS, 0, 1);
    weekly = {
      ...roll,
      usedPct: roll.effectiveUsedPct,
      remainingPct: clamp(100 - roll.effectiveUsedPct, 0, 100),
      elapsedFrac,
      expectedPct: elapsedFrac * 100,
      pacePct: roll.effectiveUsedPct - elapsedFrac * 100,
      remainingTokens: Math.max(0, (100 - roll.effectiveUsedPct) * tokensPerPct),
      capacityTokens: 100 * tokensPerPct,
      dailyCapacityTokens: (100 * tokensPerPct) / 7,
    };
    if (roll.estimated) {
      warnings.push(
        `额度快照已过期：最后一次读数来自 ${fmtDateTime(snapshot.t, timeZone)}（对应 ${fmtDateTime(roll.snapshotResetsAtMs - WEEK_MS, timeZone)} 起算的窗口，已于 ${fmtDateTime(roll.snapshotResetsAtMs, timeZone)} 重置）。当前已用额度按之后记录到的 token 消耗推算，属估算值。`,
      );
    }
  } else {
    warnings.push('日志里还没有出现过周额度信息（rate_limits），无法判断剩余额度和重置时间。');
  }

  // ---- 5 小时窗口 ----
  let fiveHour = null;
  if (snapshot && isNum(snapshot.p5) && isNum(snapshot.r5)) {
    const roll = rollForward({
      usedPct: snapshot.p5,
      resetSec: snapshot.r5,
      windowMs: FIVE_H_MS,
      points,
      tokensPerPct: tokensPerPct / 33.6, // 5 小时窗约占周额度的 1/33.6
      now,
    });
    fiveHour = {
      ...roll,
      usedPct: roll.effectiveUsedPct,
      remainingPct: clamp(100 - roll.effectiveUsedPct, 0, 100),
      elapsedFrac: clamp(roll.elapsedMs / FIVE_H_MS, 0, 1),
      expectedPct: clamp(roll.elapsedMs / FIVE_H_MS, 0, 1) * 100,
      remainingTokens: Math.max(0, (100 - roll.effectiveUsedPct) * (tokensPerPct / 33.6)),
      capacityTokens: tokensPerPct / 33.6,
    };
  }

  // ---- 每日 ----
  const days = aggregateDays(points, timeZone);
  for (const d of days) d.cacheRatio = d.tokens > 0 ? d.cached / d.tokens : 0;
  const todayKey = localDateKey(now, timeZone);
  const dayStartMs = now + msUntilLocalMidnight(now, timeZone) - 86400000;
  const windowStartMs = weekly ? weekly.nextResetsAtMs - WEEK_MS : null;
  const todayWindowStartMs = windowStartMs && windowStartMs > dayStartMs ? windowStartMs : dayStartMs;
  const today = days.find((d) => d.date === todayKey) ?? {
    date: todayKey,
    tokens: 0,
    turns: 0,
    cached: 0,
    output: 0,
    reasoning: 0,
    cacheRatio: 0,
    firstAt: null,
    lastAt: null,
  };
  today.windowTokens = sum(
    points.filter((p) => p.t >= todayWindowStartMs),
    (p) => p.tk,
  );
  today.windowTurns = points.filter((p) => p.t >= todayWindowStartMs).length;
  const priorDays = days.filter((d) => d.date !== todayKey);
  const last7 = priorDays.slice(-7);
  const last14 = priorDays.slice(-14);
  const avg7 = last7.length ? sum(last7, (d) => d.tokens) / last7.length : 0;
  const avg14 = last14.length ? sum(last14, (d) => d.tokens) / last14.length : 0;
  const peak = priorDays.reduce((best, d) => (!best || d.tokens > best.tokens ? d : best), null);

  const series = buildDaySeries(days, now, timeZone, clamp(Number(config.historyDays) || 14, 1, 120));
  const oldest = points.length ? points[0].t : null;
  const newest = points.length ? points[points.length - 1].t : null;
  const ageMs = snapshot ? Math.max(0, now - snapshot.t) : null;

  const avgTokensPerTurn = (() => {
    const withTurns = [...days].reverse().find((d) => d.turns > 0);
    return withTurns ? withTurns.tokens / withTurns.turns : 0;
  })();

  return {
    generatedAt: now,
    timeZone,
    snapshot: snapshot
      ? { t: snapshot.t, ageMs, freshness: ageMs == null ? null : freshness(ageMs), p5: snapshot.p5, pw: snapshot.pw, source: snapshot.source ?? 'session-log' }
      : null,
    weekly,
    fiveHour,
    today,
    todayKey,
    days,
    series,
    burn: {
      avg7,
      avg14,
      peak,
      tokensPerTurn: avgTokensPerTurn,
      totalTokens: sum(points, (p) => p.tk),
      totalTurns: points.length,
    },
    calibration,
    data: {
      files: stats.files ?? null,
      points: points.length,
      oldestAt: oldest,
      newestAt: newest,
      partial: Boolean(stats.partial),
      durationMs: stats.durationMs ?? null,
      cachePath: stats.cachePath ?? null,
    },
    warnings,
  };
}
