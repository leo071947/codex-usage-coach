// 通用格式化工具（无第三方依赖）

const FULLWIDTH = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;

/** 终端显示宽度（CJK 算 2 列） */
export function displayWidth(str) {
  let w = 0;
  for (const ch of String(str)) w += FULLWIDTH.test(ch) ? 2 : 1;
  return w;
}

/** 按显示宽度右填充空格 */
export function padEnd(str, width) {
  const s = String(str);
  const gap = width - displayWidth(s);
  return gap > 0 ? s + ' '.repeat(gap) : s;
}

/** 大数字 -> 1.23M / 45.6K */
export function fmtTokens(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a < 1000) return sign + String(Math.round(a));
  if (a < 1e6) return sign + (a / 1e3).toFixed(a < 1e4 ? 2 : 1) + 'K';
  if (a < 1e9) return sign + (a / 1e6).toFixed(a < 1e7 ? 2 : 1) + 'M';
  return sign + (a / 1e9).toFixed(2) + 'B';
}

/** 百分比，默认一位小数，自动去尾 */
export function fmtPct(n, digits = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const s = v.toFixed(digits);
  return (s.endsWith('.0') && digits > 0 ? s.slice(0, -2) : s) + '%';
}

/** 进度条，filled 用 █，空白用 ░ */
export function bar(pct, width = 24) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round((p / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

/** 毫秒时长 -> 4 天 3 小时 19 分（负数按绝对值处理，不表示“已过期”） */
export function fmtDur(ms) {
  if (!Number.isFinite(ms)) return '未知';
  const total = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const text = d > 0 ? `${d} 天 ${h} 小时 ${m} 分` : h > 0 ? `${h} 小时 ${m} 分` : m > 0 ? `${m} 分钟` : total > 0 ? `${total} 秒` : '0 分';
  return ms < 0 ? `-${text}` : text;
}

/** 相对时间描述（过去） */
export function fmtAgo(ms) {
  if (!Number.isFinite(ms)) return '未知';
  const diff = Date.now() - ms;
  if (diff < 0) return `还有 ${fmtDur(-diff)}`;
  return `${fmtDur(diff)}前`;
}

function zoneName(timeZone) {
  return timeZone && String(timeZone).trim() ? String(timeZone).trim() : undefined;
}

function parts(ms, timeZone) {
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: zoneName(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const out = {};
  for (const p of fmt.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** 2026-11-29 22:28 */
export function fmtDateTime(ms, timeZone) {
  if (!Number.isFinite(ms)) return '未知';
  const p = parts(ms, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** 11-29 22:28 */
export function fmtShortDateTime(ms, timeZone) {
  if (!Number.isFinite(ms)) return '未知';
  const p = parts(ms, timeZone);
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** 22:28 */
export function fmtClock(ms, timeZone) {
  if (!Number.isFinite(ms)) return '未知';
  const p = parts(ms, timeZone);
  return `${p.hour}:${p.minute}`;
}

/** 本地日期键 2026-11-29 */
export function localDateKey(ms, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zoneName(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const p = {};
  for (const x of fmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}

/** 距下一个本地零点的毫秒数 */
export function msUntilLocalMidnight(nowMs, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: zoneName(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const p = {};
  for (const x of fmt.formatToParts(new Date(nowMs))) p[x.type] = x.value;
  const elapsed = ((Number(p.hour) * 60 + Number(p.minute)) * 60 + Number(p.second)) * 1000 + (nowMs % 1000);
  return 86400000 - elapsed;
}

/** 解析 timeZone 配置；无效则回退系统时区 */
export function resolveTimeZone(tz) {
  const want = zoneName(tz);
  if (!want) return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: want }).format(new Date());
    return want;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }
}

/** 数据新鲜度分级 */
export function freshness(ageMs) {
  const m = ageMs / 60000;
  if (m <= 15) return { level: 'live', label: '实时', icon: '🟢', desc: '15 分钟内更新' };
  if (m <= 240) return { level: 'fresh', label: '较新', icon: '🟢', desc: '4 小时内更新' };
  if (m <= 1440) return { level: 'stale', label: '偏旧', icon: '🟡', desc: '超过 4 小时未更新' };
  if (m <= 10080) return { level: 'old', label: '过期', icon: '🟠', desc: '超过 1 天未更新' };
  return { level: 'veryold', label: '很旧', icon: '🔴', desc: '超过 7 天未更新' };
}

/** 安全取整 */
export function round(n, digits = 1) {
  const f = 10 ** digits;
  return Math.round(Number(n) * f) / f;
}

/** 千分位 */
export function fmtInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('en-US');
}
