// 悬浮表盘的数据契约：把 metrics/plan 压成一个小 JSON，供 PowerShell 表盘直接渲染
import { maskEmail, planLabel } from './account.mjs';
import { fmtClock, fmtDateTime, fmtDur, fmtInt, fmtPct, fmtTokens } from './util.mjs';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

function pctOf(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return clamp((part / whole) * 100, 0, 100);
}

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

/**
 * 表盘需要的三块数字：
 *  · 本周余量   —— 周额度还剩百分之几
 *  · 今日余量   —— 今天配额还剩百分之几
 *  · 今日支配预算 —— 今天还能自由支配多少 token
 */
export function dialState({ metrics, plan, account, config = {} }) {
  const tz = metrics.timeZone;
  const now = metrics.generatedAt;
  const snap = metrics.snapshot ?? null;
  const weekly = metrics.weekly ?? null;
  const fiveHour = metrics.fiveHour ?? null;

  const allowanceTokens = Number(plan.todayAllowanceTokens) || 0;
  const remainingTokens = Math.max(0, Number(plan.todayRemainingTokens) || 0);
  const usedTokens = Number(plan.todayUsedTokens) || 0;
  const dailyTokens = Number(plan.dailyTokens) || 0;

  // 一条数据都没有时，所有数字都退化成「—」，不要假装是 0
  const hasAllowance = allowanceTokens > 0;
  const hasWeekly = Boolean(weekly);
  const hasAny = hasAllowance || hasWeekly;

  const rings = {
    weekly: {
      key: 'weekly',
      label: '本周余量',
      pct: hasWeekly ? clamp(weekly.remainingPct ?? 0, 0, 100) : 0,
      value: hasWeekly ? fmtPct(weekly.remainingPct) : '—',
      color: '#3b82f6',
      estimated: Boolean(weekly?.estimated),
    },
    today: {
      key: 'today',
      label: '今日余量',
      pct: hasAllowance ? pctOf(remainingTokens, allowanceTokens) : 0,
      value: hasAllowance ? fmtPct(pctOf(remainingTokens, allowanceTokens)) : '—',
      color: '#22c55e',
      estimated: false,
    },
    budget: {
      key: 'budget',
      label: '今日支配预算',
      pct: hasAllowance && dailyTokens > 0 ? pctOf(remainingTokens, dailyTokens) : 0,
      value: hasAny ? fmtTokens(remainingTokens) : '—',
      color: '#f59e0b',
      estimated: false,
    },
  };

  const head = [planLabel(account?.plan), maskEmail(account?.email)].filter(Boolean).join(' · ');
  const freshness = snap?.freshness ?? null;

  return {
    version: 1,
    generatedAt: now,
    timeZone: tz,
    updatedText: fmtClock(now, tz),
    dateText: fmtDateTime(now, tz).slice(0, 10),
    updatedAtText: fmtDateTime(now, tz),
    stale: Boolean(snap && ['stale', 'old', 'veryold'].includes(freshness?.level)),
    freshness: freshness ? { level: freshness.level, label: freshness.label, icon: freshness.icon } : null,
    snapshot: snap
      ? { at: snap.t, ageMs: snap.ageMs, ageText: `${fmtDur(snap.ageMs)}前`, atText: fmtDateTime(snap.t, tz), estimated: Boolean(weekly?.estimated), source: snap.source ?? 'session-log' }
      : null,
    account: head || null,
    basis: plan.basis,
    headline: {
      label: '今日还能用',
      value: hasAny ? fmtTokens(remainingTokens) : '—',
      unit: 'tokens',
      sub: plan.turnsLeft ? `≈ ${fmtInt(plan.turnsLeft)} 次中等任务` : '—',
    },
    rings,
    weekly: weekly
      ? {
          remainingPct: weekly.remainingPct,
          usedPct: weekly.usedPct,
          remainingTokens: Math.round(weekly.remainingTokens ?? 0),
          remainingText: fmtTokens(weekly.remainingTokens ?? 0),
          resetsAtMs: weekly.nextResetsAtMs,
          resetsText: fmtDateTime(weekly.nextResetsAtMs, tz),
          resetsInText: fmtDur(weekly.msLeft),
          estimated: Boolean(weekly.estimated),
        }
      : null,
    today: {
      allowanceTokens,
      allowanceText: fmtTokens(allowanceTokens),
      usedTokens,
      usedText: fmtTokens(usedTokens),
      remainingTokens,
      remainingText: fmtTokens(remainingTokens),
      usedPct: pctOf(usedTokens, allowanceTokens),
      remainingPct: pctOf(remainingTokens, allowanceTokens),
      turnsLeft: Number.isFinite(plan.turnsLeft) ? plan.turnsLeft : null,
      dailyTokens,
      dailyText: fmtTokens(dailyTokens),
      pace: plan.todayPace ?? null,
    },
    budget: {
      remainingTokens,
      remainingText: fmtTokens(remainingTokens),
      dailyTokens,
      dailyText: fmtTokens(dailyTokens),
      pct: dailyTokens > 0 ? pctOf(remainingTokens, dailyTokens) : 0,
      reservePct: Number(plan.reservePct) || 0,
    },
    fiveHour: fiveHour
      ? {
          remainingPct: fiveHour.remainingPct,
          usedPct: fiveHour.usedPct,
          remainingTokens: Math.round(fiveHour.remainingTokens ?? 0),
          remainingText: fmtTokens(fiveHour.remainingTokens ?? 0),
          resetsAtMs: fiveHour.nextResetsAtMs,
          resetsText: fmtDateTime(fiveHour.nextResetsAtMs, tz),
          resetsInText: fmtDur(fiveHour.msLeft),
        }
      : null,
    weeklyPace: plan.weeklyPace ?? null,
    advice: (plan.advice ?? []).slice(0, 4),
    warnings: uniqText([
      ...(hasAny ? [] : ['还没有读到任何用量数据：先在 Codex 里正常聊几轮，或在插件里运行一次 show_dial 刷新。']),
      ...(metrics.warnings ?? []),
      ...(plan.warnings ?? []),
    ]).slice(0, 4),
    config: {
      reservePct: Number(config.reservePct) || 0,
      windowHours: Number(config.windowHours) || 5,
      historyDays: Number(config.historyDays) || 14,
      autoRefreshSec: Number(config.autoRefreshSec) || 15,
    },
    data: {
      points: metrics.data?.points ?? 0,
      files: metrics.data?.files ?? 0,
      durationMs: metrics.data?.durationMs ?? 0,
    },
  };
}
