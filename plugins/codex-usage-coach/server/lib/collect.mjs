// 数据装配：扫描日志 → 指标 → 计划 → 账号，供 MCP server / 表盘 feed 复用
import { readAccount } from './account.mjs';
import { loadConfig } from './config.mjs';
import { buildMetrics } from './metrics.mjs';
import { computePlan } from './plan.mjs';
import { scanUsage } from './scanner.mjs';
import { readLiveQuota } from './live-quota.mjs';

let cachedConfig = null;

export async function getConfig() {
  if (!cachedConfig) cachedConfig = await loadConfig();
  return cachedConfig;
}

export function resetConfigCache() {
  cachedConfig = null;
}

/**
 * @param {{reservePct?: number, force?: boolean, now?: number}} args
 * @returns {Promise<{metrics: object, plan: object, account: object|null, config: object, points: object[]}>}
 */
export async function collect({ reservePct, force = false, now = Date.now() } = {}) {
  const base = await getConfig();
  const config = reservePct == null ? base : { ...base, reservePct: Number(reservePct) };
  const { points, stats } = await scanUsage({ config, force, now });
  const quotaSnapshot = process.env.USAGE_COACH_LIVE_LIMITS === '0' ? null : await readLiveQuota();
  const metrics = buildMetrics({ points, config, now: Math.max(now, quotaSnapshot?.t ?? now), stats, quotaSnapshot });
  const plan = computePlan({ metrics, config, now });
  plan.historyDays = config.historyDays;
  const account = readAccount();
  return { metrics, plan, account, config, points };
}
