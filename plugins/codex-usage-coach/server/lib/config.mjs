// 配置读写：~/.codex/usage-coach/config.json
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, locations, writeFileAtomic } from './paths.mjs';

export const DEFAULTS = {
  version: 1,
  /** 时区；空字符串表示跟随系统 */
  timeZone: '',
  /** 周额度里预留的应急百分比（0-50） */
  reservePct: 10,
  /** 单日 token 硬上限，0 表示只按额度比例约束 */
  dailyTokenCap: 0,
  /** 期望的每日工作时段（小时），用于把一天拆成若干配额段 */
  windowHours: 5,
  /** 历史走势默认展示天数 */
  historyDays: 14,
  /** 首次全量扫描时间预算（毫秒），超出则下次继续 */
  scanBudgetMs: 45000,
  /** 无法标定时，1% 周额度默认对应多少 token */
  tokensPerPctFallback: 2000000,
  /** 仪表盘本地端口 */
  dashboardPort: 8787,
  /** 仪表盘实时刷新间隔（秒） */
  autoRefreshSec: 15,
  /** 缓存里保留多少天的明细点 */
  retentionDays: 400,
};

const NUMERIC = {
  reservePct: [0, 50],
  dailyTokenCap: [0, Number.MAX_SAFE_INTEGER],
  windowHours: [1, 24],
  historyDays: [1, 120],
  scanBudgetMs: [1000, 300000],
  tokensPerPctFallback: [100, 10000000],
  dashboardPort: [1024, 65535],
  autoRefreshSec: [5, 3600],
  retentionDays: [7, 1000],
};

let cached = null;

function sanitize(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in raw)) continue;
    const val = raw[key];
    if (key === 'timeZone') {
      out.timeZone = typeof val === 'string' ? val : '';
      continue;
    }
    if (key === 'version') {
      out.version = 1;
      continue;
    }
    const range = NUMERIC[key];
    const num = Number(val);
    if (!Number.isFinite(num)) continue;
    out[key] = range ? Math.min(range[1], Math.max(range[0], num)) : num;
  }
  return out;
}

/** 仅测试用：暴露配置收敛逻辑 */
export function sanitizeForTest(raw) {
  return sanitize(raw);
}

export function loadConfig({ reload = false } = {}) {  if (cached && !reload) return { ...cached };
  const file = locations.config();
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    raw = null;
  }
  cached = sanitize(raw);
  return { ...cached };
}

export function saveConfig(patch) {
  const next = sanitize({ ...loadConfig({ reload: true }), ...patch });
  ensureDir(path.dirname(locations.config()));
  writeFileAtomic(locations.config(), JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2) + '\n');
  cached = next;
  return { ...next };
}

/** 只返回用户可能关心的字段（给 MCP 结构化输出用） */
export function publicConfig(cfg) {
  return {
    timeZone: cfg.timeZone || 'system',
    reservePct: cfg.reservePct,
    dailyTokenCap: cfg.dailyTokenCap,
    windowHours: cfg.windowHours,
    historyDays: cfg.historyDays,
    tokensPerPctFallback: cfg.tokensPerPctFallback,
    dashboardPort: cfg.dashboardPort,
    autoRefreshSec: cfg.autoRefreshSec,
  };
}
