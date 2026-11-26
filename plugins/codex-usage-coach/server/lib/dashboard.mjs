// 单文件仪表盘：内联数据 + 可选每 N 秒向本地 /api/state 拉一次局部刷新
import { maskEmail, planLabel } from './account.mjs';
import { fmtDateTime, fmtDur, fmtInt, fmtPct, fmtShortDateTime, fmtTokens } from './util.mjs';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function ring(pct, color, label) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct || 0));
  const dash = (clamped / 100) * c;
  return `<svg viewBox="0 0 120 120" class="ring" role="img" aria-label="${esc(label)} ${clamped.toFixed(1)}%">
    <circle cx="60" cy="60" r="${r}" class="ring-track"/>
    <circle cx="60" cy="60" r="${r}" class="ring-value" stroke="${color}"
      stroke-dasharray="${dash.toFixed(1)} ${(c - dash).toFixed(1)}" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" class="ring-num">${clamped.toFixed(1)}<tspan class="ring-unit">%</tspan></text>
    <text x="60" y="80" class="ring-cap">${esc(label)}</text>
  </svg>`;
}

function paceChip(pace, prefix) {
  if (!pace || pace.status === 'unknown') return '';
  return `<span class="chip" style="--chip:${esc(pace.color || '#64748b')}">${prefix ? esc(prefix) + ' ' : ''}${esc(pace.icon)} ${esc(pace.label)}</span>`;
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

/** 缓存路径太长，只显示 ~/.codex 之后的部分 */
function shortCachePath(cachePath) {
  if (!cachePath) return '—';
  const marker = '.codex';
  const idx = cachePath.lastIndexOf(marker);
  if (idx >= 0) return `~/${cachePath.slice(idx + marker.length).replace(/\\/g, '/').replace(/^\//, '')}`;
  const parts = cachePath.split(/[\\/]/).filter(Boolean);
  return `…/${parts.slice(-2).join('/')}`;
}

function dayBars(days) {
  if (!days.length) return '<p class="muted">还没有历史记录。</p>';
  const max = Math.max(...days.map((d) => d.tokens), 1);
  return `<div class="bars">${days
    .map((d) => {
      const h = Math.max(2, (d.tokens / max) * 100);
      const title = `${d.date} · ${fmtTokens(d.tokens)} tokens · ${fmtInt(d.turns)} 轮`;
      return `<div class="bar-col" title="${esc(title)}">
        <div class="bar-wrap"><div class="bar-fill" style="height:${h.toFixed(1)}%"></div></div>
        <div class="bar-label">${esc(d.date.slice(5))}</div>
      </div>`;
    })
    .join('')}</div>`;
}

function slotTable(schedule) {
  if (!schedule?.length) return '';
  return `<table class="tbl">
    <thead><tr><th>时段</th><th class="num">建议配额</th><th class="num">占比</th></tr></thead>
    <tbody>${schedule
      .map(
        (s) => `<tr><td>${esc(fmtShortDateTime(s.startMs))} – ${esc(fmtShortDateTime(s.endMs).slice(6))}</td>
        <td class="num">${esc(fmtTokens(s.tokens))}</td><td class="num">${esc(fmtPct(s.pct))}</td></tr>`,
      )
      .join('')}</tbody></table>`;
}

/** 只渲染 #app 内部，供 /api/state 局部刷新 */
export function dashboardBody({ metrics, plan, account, config }) {
  const tz = metrics.timeZone;
  const now = metrics.generatedAt;
  const w = metrics.weekly;
  const fh = metrics.fiveHour;
  const snap = metrics.snapshot;
  const planName = planLabel(account?.plan);
  const mail = maskEmail(account?.email);
  const fresh = snap?.freshness;

  const head = `<header class="head">
    <div>
      <h1>Codex 用量管家</h1>
      <p class="sub">${[planName, mail].filter(Boolean).map(esc).join(' · ') || '未登录信息'}</p>
    </div>
    <div class="head-right">
      <span class="pill ${esc(fresh?.tone || 'muted')}">${esc(fresh?.icon || '⚪')} 快照${esc(fresh?.label || '未知')}</span>
      <div class="stamp">更新 ${esc(fmtDateTime(now, tz))}<br/><span class="muted">数据 ${esc(snap ? fmtDur(snap.ageMs) + '前' : '无')}</span></div>
    </div>
  </header>`;

  const hero = `<section class="grid hero">
    <div class="card ring-card">
      ${ring(w?.usedPct ?? 0, '#3b82f6', '周额度已用')}
      <div class="ring-side">
        <div class="big">${esc(w ? fmtPct(w.remainingPct) : '—')}<span class="unit"> 剩余</span></div>
        <div class="muted">${w ? `≈ ${esc(fmtTokens(w.remainingTokens))} tokens` : '无周额度快照'}</div>
        ${w ? `<div class="muted">重置 ${esc(fmtDateTime(w.nextResetsAtMs, tz))}</div>` : ''}
        ${w ? `<div class="muted">还有 ${esc(fmtDur(w.msLeft))}</div>` : ''}
        ${w?.estimated ? '<div class="warn">该窗口已重置，现值按 token 消耗推定</div>' : ''}
      </div>
    </div>
    <div class="card ring-card">
      ${ring(fh?.usedPct ?? 0, '#22c55e', '5 小时窗已用')}
      <div class="ring-side">
        <div class="big">${esc(fh ? fmtPct(fh.remainingPct) : '—')}<span class="unit"> 剩余</span></div>
        <div class="muted">${fh ? `≈ ${esc(fmtTokens(fh.remainingTokens))} tokens` : '无窗口快照'}</div>
        ${fh ? `<div class="muted">重置 ${esc(fmtDateTime(fh.nextResetsAtMs, tz))}</div>` : ''}
        ${fh ? `<div class="muted">还有 ${esc(fmtDur(fh.msLeft))}</div>` : ''}
      </div>
    </div>
    <div class="card">
      <h2>今日</h2>
      <div class="big">${esc(fmtTokens(metrics.today.tokens))}<span class="unit"> tokens</span></div>
      <div class="muted">${esc(fmtInt(metrics.today.turns))} 轮 · 缓存命中 ${
        metrics.today.turns > 0 ? esc(fmtPct((metrics.today.cacheRatio || 0) * 100, 0)) : '—'
      }</div>
      <hr/>
      <div class="kv"><span>今日额度</span><b>${esc(fmtTokens(plan.todayAllowanceTokens))}</b></div>
      <div class="kv"><span>还能用</span><b>${esc(fmtTokens(plan.todayRemainingTokens))}</b></div>
      <div class="kv"><span>日均建议</span><b>${esc(fmtTokens(plan.dailyTokens))}</b></div>
      <div class="kv"><span>预留缓冲</span><b>${esc(fmtPct(plan.reservePct))}</b></div>
      <div class="chips">${paceChip(plan.todayPace, '今日')}${paceChip(plan.weeklyPace, '本周')}</div>
    </div>
  </section>`;

  const advice = plan.advice?.length
    ? `<section class="card wide"><h2>建议</h2><ul class="advice">${plan.advice.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></section>`
    : '';

  const warnings = uniqText([...(metrics.warnings || []), ...(plan.warnings || [])]);
  const warnBox = warnings.length
    ? `<section class="card wide warnbox"><h2>数据提示</h2><ul class="advice">${warnings.map((warn) => `<li>${esc(warn)}</li>`).join('')}</ul></section>`
    : '';

  const chart = `<section class="card wide"><h2>${metrics.days.length ? `近 ${metrics.days.length} 天消耗` : '消耗历史（暂无记录）'}</h2>
    ${dayBars(metrics.days.slice(-14))}
    <div class="legend"><span>日均（近 7 天）<b>${esc(fmtTokens(metrics.burn.avg7))}</b></span>
    <span>峰值<b>${esc(metrics.burn.peak ? metrics.burn.peak.date + ' · ' + fmtTokens(metrics.burn.peak.tokens) : '—')}</b></span>
    <span>1% 周额度 ≈<b>${esc(fmtTokens(metrics.calibration?.tokensPerPct))}</b>（${esc(metrics.calibration?.method === 'window' ? '实测 ' + metrics.calibration.samples + ' 点' : '默认估值')}）</span></div></section>`;

  const slots = plan.schedule?.length ? `<section class="card wide"><h2>剩余时段分配（每批 ${esc(String(plan.windowHours))} 小时）</h2>${slotTable(plan.schedule)}</section>` : '';

  const meta = `<footer class="foot">
    <span>${esc(fmtInt(metrics.data.points))} 个用量点</span>
    <span>${esc(String(metrics.data.files ?? '?'))} 个会话文件</span>
    <span>最早 ${esc(fmtDateTime(metrics.data.oldestAt ?? now, tz))}</span>
    <span>缓存 ${esc(shortCachePath(metrics.data.cachePath))}</span>
    <span>扫描 ${esc(fmtInt(metrics.data.durationMs || 0))} ms${metrics.data.partial ? '（未扫完）' : ''}</span>
  </footer>`;

  return head + hero + advice + slots + chart + warnBox + meta;
}

export function dashboardPage({ metrics, plan, account, config, refreshSec = 15, serve = false }) {
  const body = dashboardBody({ metrics, plan, account, config });
  const data = JSON.stringify({ generatedAt: metrics.generatedAt }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="data:,"/>
<title>Codex 用量管家</title>
<style>
  :root{--bg:#0b1220;--card:#131c2e;--line:#22304a;--fg:#e6edf7;--muted:#8fa3bf;--accent:#3b82f6}
  *{box-sizing:border-box}
  body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.55 -apple-system,"Segoe UI",system-ui,"Microsoft YaHei",sans-serif}
  .wrap{max-width:1080px;margin:0 auto}
  h1{margin:0;font-size:22px;letter-spacing:.5px}
  h2{margin:0 0 10px;font-size:13px;color:var(--muted);font-weight:600;letter-spacing:1px;text-transform:uppercase}
  .head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px;flex-wrap:wrap}
  .sub{margin:4px 0 0;color:var(--muted)}
  .head-right{text-align:right;font-size:12px}
  .stamp .muted{font-size:11px}
  .pill{display:inline-block;padding:3px 10px;border-radius:999px;border:1px solid var(--line);font-size:12px;margin-bottom:6px}
  .pill.live,.pill.fresh{color:#22c55e;border-color:#14532d;background:#052e16}
  .pill.stale{color:#f59e0b;border-color:#78350f;background:#2a1a05}
  .pill.old{color:#fb923c;border-color:#7c2d12;background:#2a1005}
  .pill.veryold{color:#ef4444;border-color:#7f1d1d;background:#2a0505}
  .grid{display:grid;gap:16px}
  .hero{grid-template-columns:1fr 1fr 1fr}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
  .wide{margin-top:16px}
  .ring-card{display:flex;align-items:center;gap:14px}
  .ring{width:120px;height:120px;flex:0 0 auto}
  .ring-track{fill:none;stroke:#1e293b;stroke-width:10}
  .ring-value{fill:none;stroke-width:10;stroke-linecap:round;transition:stroke-dasharray .6s ease}
  .ring-num{fill:var(--fg);font-size:24px;font-weight:700;text-anchor:middle}
  .ring-unit{font-size:12px;fill:var(--muted)}
  .ring-cap{fill:var(--muted);font-size:10px;text-anchor:middle}
  .big{font-size:24px;font-weight:700;line-height:1.2}
  .unit{font-size:13px;font-weight:400;color:var(--muted)}
  .muted{color:var(--muted);font-size:12px}
  hr{border:0;border-top:1px solid var(--line);margin:12px 0}
  .kv{display:flex;justify-content:space-between;font-size:13px;padding:3px 0}
  .kv span{color:var(--muted)}
  .chips{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap}
  .chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--chip);color:var(--chip)}
  .bars{display:flex;align-items:flex-end;gap:6px;height:150px;margin-top:6px}
  .bar-col{flex:1;display:flex;flex-direction:column;height:100%}
  .bar-wrap{flex:1;display:flex;align-items:flex-end}
  .bar-fill{width:100%;background:linear-gradient(180deg,#60a5fa,#2563eb);border-radius:4px 4px 0 0;min-height:2px}
  .bar-label{text-align:center;font-size:10px;color:var(--muted);margin-top:6px}
  .legend{display:flex;gap:22px;flex-wrap:wrap;margin-top:14px;font-size:12px;color:var(--muted)}
  .legend b{color:var(--fg);margin-left:6px;font-weight:600}
  .tbl{width:100%;border-collapse:collapse;font-size:13px}
  .tbl th,.tbl td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left}
  .tbl th{color:var(--muted);font-weight:600;font-size:12px}
  .tbl .num{text-align:right;font-variant-numeric:tabular-nums}
  .advice{margin:0;padding-left:18px}
  .advice li{margin:5px 0}
  .warnbox h2{color:#f59e0b}
  .warn{margin-top:8px;color:#f59e0b;font-size:11px;line-height:1.4}
  .foot{display:flex;gap:18px;flex-wrap:wrap;margin-top:18px;padding-top:14px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)}
  #live{font-size:11px;color:var(--muted);margin-top:10px;text-align:right}
  @media(max-width:820px){.hero{grid-template-columns:1fr}body{padding:14px}}
</style></head>
<body><div class="wrap">
<div id="app">${body}</div>
<div id="live">${serve ? `● 实时模式 · 每 ${esc(String(refreshSec))} 秒自动刷新` : '○ 静态页面 · 重新生成可获取最新数据'}</div>
</div>
<script>
  const inlineData = ${data};
  const SERVE = ${serve ? 'true' : 'false'};
  const REFRESH_MS = ${Math.max(5, Number(refreshSec) || 15)} * 1000;
  if (SERVE && location.protocol.startsWith('http')) {
    let timer = null;
    async function pull() {
      try {
        const r = await fetch('/api/state?_=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        if (d && d.html) document.getElementById('app').innerHTML = d.html;
        document.getElementById('live').textContent = '● 实时模式 · 上次刷新 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
      } catch (e) {
        document.getElementById('live').textContent = '○ 刷新失败（' + e.message + '），稍后重试';
      }
      timer = setTimeout(pull, REFRESH_MS);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { clearTimeout(timer); timer = null; }
      else if (!timer) pull();
    });
    timer = setTimeout(pull, REFRESH_MS);
  }
</script>
</body></html>`;
}
