#!/usr/bin/env node
// Codex 用量管家 · MCP server（stdio JSON-RPC，零依赖）
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collect, getConfig, resetConfigCache } from './lib/collect.mjs';
import { saveConfig, publicConfig } from './lib/config.mjs';
import { dashboardPage, dashboardBody } from './lib/dashboard.mjs';
import { dialState } from './lib/dial.mjs';
import { companionCommand } from './lib/companion-platform.mjs';
import { appendLog, ensureDir, locations, writeFileAtomic } from './lib/paths.mjs';
import { historyTable, planCard, reportMarkdown, statusCard } from './lib/render.mjs';
import { fmtDateTime, fmtDur, fmtInt, fmtTokens } from './lib/util.mjs';

const SERVER_INFO = { name: 'codex-usage-coach', version: '0.1.0' };
const PROTOCOL = '2025-06-18';

function log(...args) {
  try {
    appendLog(`[${new Date().toISOString()}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
  } catch {
    /* 日志失败不影响主流程 */
  }
}

// ---------------------------------------------------------------- 数据装配（实现在 lib/collect.mjs）

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function dialWindowPidFile() {
  return path.join(path.dirname(locations.dial()), 'dial-window.pid');
}

/** 返回正在运行的表盘窗口 PID，没有则 null */
function dialWindowPid() {
  try {
    const raw = fs.readFileSync(dialWindowPidFile(), 'utf8').trim();
    const pid = Number(raw);
    if (!pid || !Number.isFinite(pid)) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

async function writeDial(state) {
  const payload = dialState(state);
  payload.feed = { intervalSec: 0, wroteAt: Date.now(), durationMs: 0, error: null, source: 'mcp' };
  await ensureDir(path.dirname(locations.dial()));
  await writeFileAtomic(locations.dial(), JSON.stringify(payload, null, 2));
  return locations.dial();
}

/** 启动悬浮表盘（PowerShell + WinForms）。已运行则直接返回。 */
function waitForDialReady(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (dialWindowPid()) return resolve(true);
      if (Date.now() - startedAt >= timeoutMs) return resolve(false);
      setTimeout(tick, 150);
    };
    tick();
  });
}

async function launchDial({ interval = 30, restart = false } = {}) {
  const existing = dialWindowPid();
  if (existing && !restart) return { pid: existing, started: false };
  if (existing && restart) {
    try {
      process.kill(existing);
    } catch {
      /* 忽略 */
    }
    if (process.platform === 'darwin') {
      // Let AppKit terminate the feed and remove its PID before `open` can
      // reuse the same application instance during a restart.
      await new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const poll = () => {
          try { process.kill(existing, 0); } catch { resolve(); return; }
          if (Date.now() >= deadline) { reject(new Error('Mac 猫咪仍在退出，请稍后重试。')); return; }
          setTimeout(poll, 100);
        };
        poll();
      });
    }
    try {
      fs.rmSync(dialWindowPidFile(), { force: true });
    } catch {
      /* 忽略 */
    }
  }
  const command = companionCommand(process.platform, PLUGIN_ROOT, { interval, home: locations.codexHome() });
  const child = spawn(command.executable, command.args, {
    detached: true, stdio: 'ignore', cwd: PLUGIN_ROOT, windowsHide: true,
    windowsVerbatimArguments: command.windowsVerbatimArguments,
  });
  let spawnError = null;
  child.on('error', (err) => {
    spawnError = err;
  });
  child.unref();
  const ready = spawnError ? false : await waitForDialReady(command.readyTimeout);
  return { pid: dialWindowPid() || child.pid || null, started: true, ready, error: spawnError ? String(spawnError.message || spawnError) : null };
}

function stopDial() {
  const pid = dialWindowPid();
  if (!pid) return false;
  try {
    process.kill(pid);
  } catch {
    /* 忽略 */
  }
  try {
    fs.rmSync(dialWindowPidFile(), { force: true });
  } catch {
    /* 忽略 */
  }
  return true;
}

function publicState({ metrics, plan, account, config }) {
  return {
    generatedAt: metrics.generatedAt,
    timeZone: metrics.timeZone,
    account: account ? { plan: account.plan, email: account.email ? account.email.replace(/^(.).*(@.*)$/, '$1***$2') : null } : null,
    snapshot: metrics.snapshot,
    weekly: metrics.weekly,
    fiveHour: metrics.fiveHour,
    today: metrics.today,
    burn: metrics.burn,
    calibration: metrics.calibration,
    plan: {
      basis: plan.basis,
      dailyTokens: plan.dailyTokens,
      dailyPct: plan.dailyPct,
      todayAllowanceTokens: plan.todayAllowanceTokens,
      todayRemainingTokens: plan.todayRemainingTokens,
      todayUsedTokens: plan.todayUsedTokens,
      todayPace: plan.todayPace,
      weeklyPace: plan.weeklyPace,
      reservePct: plan.reservePct,
      advice: plan.advice,
    },
    data: metrics.data,
    warnings: [...new Set([...metrics.warnings, ...plan.warnings])],
    config: publicConfig(config),
  };
}

async function writeDashboard(state, { serve = false, port } = {}) {
  const cfg = state.config;
  const html = dashboardPage({
    ...state,
    refreshSec: cfg.autoRefreshSec,
    serve,
  });
  await ensureDir(path.dirname(locations.dashboard()));
  await writeFileAtomic(locations.dashboard(), html);
  await writeFileAtomic(
    locations.dashboardData(),
    JSON.stringify(
      {
        generatedAt: state.metrics.generatedAt,
        updatedAt: new Date(state.metrics.generatedAt).toISOString(),
        ...publicState(state),
      },
      null,
      2,
    ),
  );
  return locations.dashboard();
}

// ---------------------------------------------------------------- 本地 http 服务（惰性刷新）
let live = null; // { server, port, state, lastAt, busy }

function listen(handler, port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler);
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

async function listenWithFallback(handler, preferredPort) {
  let port = Number(preferredPort) || 8787;
  for (let i = 0; i < 12; i += 1) {
    try {
      const srv = await listen(handler, port);
      srv.unref();
      return { server: srv, port: srv.address().port };
    } catch (err) {
      if (err?.code !== 'EADDRINUSE') throw err;
      port += 1;
    }
  }
  throw new Error(`端口 ${preferredPort} 起的 12 个端口都被占用`);
}

const LIVE_MIN_INTERVAL_MS = 8000;

function liveHandler(req, res) {
  const url = String(req.url || '/');
  if (url.startsWith('/api/state')) {
    const refresh = async () => {
      if (!live || live.busy || Date.now() - live.lastAt < LIVE_MIN_INTERVAL_MS) return;
      live.busy = true;
      try {
        live.state = await collect({ now: Date.now() });
        live.lastAt = Date.now();
      } catch (err) {
        log('实时刷新失败', err?.message || String(err));
      } finally {
        live.busy = false;
      }
    };
    refresh()
      .catch(() => {})
      .finally(() => {
        const state = live?.state;
        if (!state) {
          res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'not ready' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ html: dashboardBody(state), generatedAt: state.metrics.generatedAt }));
      });
    return;
  }
  if (url === '/' || url.startsWith('/?') || url === '/index.html') {
    if (!live?.state) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('正在加载…');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(dashboardPage({ ...live.state, refreshSec: live.state.config.autoRefreshSec, serve: true }));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

async function ensureLiveServer(state, preferredPort) {
  if (live?.server) {
    live.state = state;
    return live;
  }
  const { server, port } = await listenWithFallback(liveHandler, preferredPort);
  live = { server, port, state, lastAt: Date.now(), busy: false };
  return live;
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch (err) {
    log('openBrowser 失败', err.message);
    return false;
  }
}

// ---------------------------------------------------------------- 工具定义
const TOOLS = [
  {
    name: 'usage_status',
    title: 'Codex 剩余额度',
    description:
      '查看 Codex 当前周额度与 5 小时窗口的已用/剩余百分比、下次重置时间、数据快照有多旧。只读 ~/.codex/sessions 下的会话日志，不联网。',
    inputSchema: {
      type: 'object',
      properties: {
        refresh: { type: 'boolean', description: '为 true 时忽略增量缓存，重新扫描全部会话文件（较慢，默认 false）' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'daily_plan',
    title: '今日用量计划',
    description:
      '按剩余周额度与剩余时间算出今天（以及今天剩下来每 5 小时时段）建议消耗多少 tokens；包含预留缓冲、节奏判断和行动建议。',
    inputSchema: {
      type: 'object',
      properties: {
        reservePct: { type: 'number', description: '应急预留百分比（0-90），不指定则用配置值（默认 10）' },
        refresh: { type: 'boolean', description: '重新扫描全部会话文件' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'usage_history',
    title: '历史消耗',
    description: '列出最近若干天每天消耗的 token 数、轮次、缓存命中率和相对日均的倍数。',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '要展示的天数（1-120），默认取配置的 historyDays' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'write_usage_report',
    title: '导出用量报告',
    description: '生成一份 Markdown 用量报告（额度、今日计划、时段分配、建议、历史表），默认写到 ~/.codex/usage-coach/reports/ 下。',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '报告里历史表的天数（1-120）' },
        outPath: { type: 'string', description: '自定义输出路径；相对路径基于 ~/.codex/usage-coach/reports/' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'open_dashboard',
    title: '打开用量仪表盘',
    description:
      '生成 HTML 仪表盘（周额度环、5 小时环、今日额度、时段分配、近 14 天柱状图、数据新鲜度），可启动 127.0.0.1 本地服务自动刷新并在浏览器打开。',
    inputSchema: {
      type: 'object',
      properties: {
        serve: { type: 'boolean', description: '启动本地 http 服务以支持自动刷新（默认 true）' },
        open: { type: 'boolean', description: '用默认浏览器打开（默认 true）' },
        port: { type: 'number', description: '本地端口，默认用配置的 dashboardPort（8787），被占用则自动 +1' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'show_dial',
    title: '打开悬浮表盘',
    description:
      '启动跟随 Codex 输入框的像素猫咪：停步气泡显示本周与 5 小时窗口余量，右键在头顶查看详情。数据每 30 秒自动刷新，跟随 Codex 显隐和退出。已运行时不重复启动。',
    inputSchema: {
      type: 'object',
      properties: {
        interval: { type: 'number', description: '自动刷新间隔秒数（10-600），默认 30' },
        restart: { type: 'boolean', description: '为 true 时先关掉已有表盘再重开' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'hide_dial',
    title: '关闭悬浮表盘',
    description: '关掉正在运行的桌面表盘小窗（不影响数据与详细面板）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'configure',
    title: '查看/修改配置',
    description:
      '读取或修改用量管家配置：reservePct（预留）、timeZone（时区）、dailyTokenCap（每日上限）、windowHours（配额切片）、dashboardPort、autoRefreshSec、historyDays、tokensPerPctFallback。',
    inputSchema: {
      type: 'object',
      properties: {
        reservePct: { type: 'number', description: '应急预留百分比 0-90' },
        timeZone: { type: 'string', description: 'IANA 时区，如 Asia/Shanghai；空字符串表示使用系统时区' },
        dailyTokenCap: { type: 'number', description: '每日硬上限 tokens，0 表示不限制' },
        windowHours: { type: 'number', description: '配额切片小时数 1-24' },
        dashboardPort: { type: 'number', description: '仪表盘端口 1024-65535' },
        autoRefreshSec: { type: 'number', description: '仪表盘自动刷新秒数 5-3600' },
        historyDays: { type: 'number', description: '历史展示天数 1-120' },
        tokensPerPctFallback: { type: 'number', description: '样本不足时 1% 周额度折算的 tokens 数' },
      },
      additionalProperties: false,
    },
  },
];

const INSTRUCTIONS = [
  '你是 Codex 用量管家。用户问“还能用多少 / 今天该怎么用 / 额度还有几天 / 最近用了多少”时，优先调用 daily_plan 或 usage_status，而不是凭印象回答。',
  '回答时给出具体数字（剩余百分比、tokens、重置时间）和一句可执行建议；如果数据快照较旧（stale/old/veryold），明确说明这是推估值。',
  '需要趋势或复盘时用 usage_history；要留档用 write_usage_report；想长期挂着看用 open_dashboard。',
].join('\n');

// ---------------------------------------------------------------- 工具实现
async function callTool(name, args = {}) {
  const now = Date.now();
  switch (name) {
    case 'usage_status': {
      const state = await collect({ force: !!args.refresh, now });
      await writeDashboard(state, { serve: false });
      await writeDial(state);
      const text = statusCard(state);
      return { text, structuredContent: publicState(state) };
    }
    case 'daily_plan': {
      const state = await collect({ reservePct: args.reservePct, force: !!args.refresh, now });
      await writeDashboard(state, { serve: false });
      await writeDial(state);
      return { text: planCard(state), structuredContent: publicState(state) };
    }
    case 'usage_history': {
      const state = await collect({ now });
      const days = Math.max(1, Math.min(120, Math.round(args.days || state.config.historyDays)));
      const text = historyTable({ metrics: state.metrics, plan: { ...state.plan, historyDays: days } });
      return {
        text,
        structuredContent: { generatedAt: state.metrics.generatedAt, days: state.metrics.days.slice(-days), burn: state.metrics.burn, data: state.metrics.data },
      };
    }
    case 'write_usage_report': {
      const state = await collect({ now });
      const md = reportMarkdown({ ...state, generatedAt: now });
      const name = `codex-usage-${new Date(now).toISOString().slice(0, 10)}.md`;
      const target = args.outPath
        ? path.isAbsolute(args.outPath)
          ? args.outPath
          : path.join(locations.reports(), args.outPath)
        : path.join(locations.reports(), name);
      await ensureDir(path.dirname(target));
      await writeFileAtomic(target, md);
      return {
        text: `已生成用量报告：${target}\n\n${md.split('\n').slice(0, 24).join('\n')}\n\n…（完整内容见文件）`,
        structuredContent: { path: target, bytes: Buffer.byteLength(md), generatedAt: now },
      };
    }
    case 'open_dashboard': {
      const state = await collect({ now });
      const serve = args.serve !== false;
      await writeDashboard(state, { serve });
      await writeDial(state);
      let url = null;
      if (serve) {
        const { port } = await ensureLiveServer(state, Number(args.port) || state.config.dashboardPort);
        url = `http://127.0.0.1:${port}/`;
        if (args.open !== false) openBrowser(url);
      } else if (args.open !== false) {
        openBrowser(`file:///${locations.dashboard().replace(/\\/g, '/')}`);
      }
      return {
        text: [
          `仪表盘已更新：${locations.dashboard()}`,
          serve ? `本地服务：${url}（每 ${state.config.autoRefreshSec} 秒自动刷新，关闭终端后失效）` : '静态文件模式：重新调用本工具可刷新数据',
          `数据快照：${
            state.metrics.snapshot
              ? `${fmtDateTime(state.metrics.snapshot.t, state.metrics.timeZone)}（${state.metrics.snapshot.freshness?.label ?? '未知'}，${fmtDur(state.metrics.snapshot.ageMs)}前）`
              : '无'
          }`,
          `周额度剩余 ${state.metrics.weekly ? state.metrics.weekly.remainingPct.toFixed(1) + '%' : '未知'}`,
        ].join('\n'),
        structuredContent: { path: locations.dashboard(), url, served: serve, generatedAt: now },
      };
    }
    case 'show_dial': {
      const state = await collect({ now });
      await writeDial(state);
      const interval = Math.max(10, Math.min(600, Math.round(Number(args.interval) || state.config.autoRefreshSec * 2 || 30)));
      const launched = await launchDial({ interval, restart: !!args.restart });
      const lines = [
        launched.started ? '猫咪客户端已启动（自动定位 Codex 输入框；macOS 首次使用需授予辅助功能权限）。' : '悬浮表盘已经在运行，没有重复启动。',
        `刷新间隔：每 ${interval} 秒`,
        `本周余量：${state.metrics.weekly ? state.metrics.weekly.remainingPct.toFixed(1) + '%' : '未知'}`,
        `今日余量：${state.plan.todayRemainingTokens != null ? fmtTokens(state.plan.todayRemainingTokens) : '未知'} tokens（今日额度 ${fmtTokens(state.plan.todayAllowanceTokens || 0)}）`,
        '用法：左键按住可拖动；单击展开/收起详情；右键有「立即刷新 / 打开详细面板 / 退出表盘」。',
      ];
      if (launched.started && launched.ready === false) {
        lines.push(`⚠ 表盘进程没能确认启动（${launched.error || '启动等待超时；Mac 请检查 mac-build.log'}）。可以再试一次 show_dial restart=true，或看日志：${path.join(path.dirname(locations.dial()), 'dial-error.log')}`);
      }
      return {
        text: lines.join('\n'),
        structuredContent: { pid: launched.pid, started: launched.started, intervalSec: interval, dialPath: locations.dial(), generatedAt: now },
      };
    }
    case 'hide_dial': {
      const stopped = stopDial();
      return {
        text: stopped ? '已关闭悬浮表盘。' : '当前没有正在运行的悬浮表盘。',
        structuredContent: { stopped },
      };
    }
    case 'configure': {
      const patch = {};
      for (const key of [
        'reservePct',
        'timeZone',
        'dailyTokenCap',
        'windowHours',
        'dashboardPort',
        'autoRefreshSec',
        'historyDays',
        'tokensPerPctFallback',
      ]) {
        if (args[key] !== undefined && args[key] !== null) patch[key] = args[key];
      }
      const hasPatch = Object.keys(patch).length > 0;
      if (hasPatch) {
        const saved = await saveConfig(patch);
        resetConfigCache();
      }
      const cfg = await getConfig();
      const lines = ['当前配置：'];
      for (const [k, v] of Object.entries(publicConfig(cfg))) lines.push(`  ${k} = ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      lines.push('');
      lines.push(`配置文件：${locations.config()}`);
      return { text: lines.join('\n'), structuredContent: { config: publicConfig(cfg), path: locations.config(), changed: hasPatch } };
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

// ---------------------------------------------------------------- JSON-RPC 分发
export async function handle(msg) {
  const { id, method, params } = msg || {};
  const respond = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message, data) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });

  if (!method) return fail(-32600, 'Invalid Request');
  if (id === undefined || id === null) {
    if (method === 'notifications/initialized' || method === 'initialized') log('client initialized');
    return null;
  }

  try {
    switch (method) {
      case 'initialize':
        return respond({
          protocolVersion: params?.protocolVersion || PROTOCOL,
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      case 'ping':
        return respond({});
      case 'tools/list':
        return respond({ tools: TOOLS });
      case 'tools/call': {
        const name = params?.name;
        const args = params?.arguments || {};
        if (!name) return fail(-32602, '缺少工具名');
        const started = Date.now();
        const out = await callTool(name, args);
        log(`tools/call ${name} ok ${Date.now() - started}ms`);
        return respond({
          content: [{ type: 'text', text: out.text }],
          ...(out.structuredContent ? { structuredContent: out.structuredContent } : {}),
          isError: false,
        });
      }
      case 'resources/list':
        return respond({ resources: [] });
      case 'resources/templates/list':
        return respond({ resourceTemplates: [] });
      case 'prompts/list':
        return respond({ prompts: [] });
      case 'logging/setLevel':
        return respond({});
      default:
        return fail(-32601, `不支持的 method: ${method}`);
    }
  } catch (err) {
    log(`处理 ${method} 失败`, err?.stack || err?.message || String(err));
    if (method === 'tools/call') {
      return respond({ content: [{ type: 'text', text: `执行失败：${err?.message || err}` }], isError: true });
    }
    return fail(-32603, err?.message || String(err));
  }
}

// ---------------------------------------------------------------- stdio 传输（同时支持按行与 Content-Length 两种分帧）
function createReader(onMessage) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      // Content-Length 分帧
      if (buf.length >= 15 && buf.subarray(0, 15).toString('latin1').toLowerCase() === 'content-length:') {
        const sep = buf.indexOf('\r\n\r\n');
        if (sep < 0) return;
        const header = buf.subarray(0, sep).toString('latin1');
        const m = /content-length:\s*(\d+)/i.exec(header);
        if (!m) {
          buf = buf.subarray(sep + 4);
          continue;
        }
        const len = Number(m[1]);
        if (buf.length < sep + 4 + len) return;
        const body = buf.subarray(sep + 4, sep + 4 + len).toString('utf8');
        buf = buf.subarray(sep + 4 + len);
        try {
          onMessage(JSON.parse(body));
        } catch (err) {
          log('JSON 解析失败', err.message);
        }
        continue;
      }
      // 按行分帧
      const nl = buf.indexOf(0x0a);
      if (nl < 0) return;
      const line = buf.subarray(0, nl).toString('utf8').trim();
      buf = buf.subarray(nl + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line));
      } catch (err) {
        log('JSON 解析失败', err.message);
      }
    }
  };
}

function send(obj) {
  if (!obj) return;
  process.stdout.write(JSON.stringify(obj) + '\n');
}

export function main() {
  // Start only in the real stdio entrypoint, never during imports/tests.
  if (['win32', 'darwin'].includes(process.platform) && process.env.USAGE_COACH_AUTO_PET !== '0') {
    launchDial().catch(err => log('auto pet startup failed', err.message));
  }
  const reader = createReader((msg) => {
    handle(msg)
      .then((res) => send(res))
      .catch((err) => {
        log('未捕获错误', err?.stack || String(err));
        send({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32603, message: err?.message || String(err) } });
      });
  });
  process.stdin.on('data', reader);
  process.stdin.on('end', () => process.exit(0));
  process.on('uncaughtException', (err) => log('uncaughtException', err?.stack || String(err)));
  process.on('unhandledRejection', (err) => log('unhandledRejection', err?.stack || String(err)));
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  log(`server 启动 pid=${process.pid} node=${process.version}`);
}

// 直接被 node 启动时才进入 stdio 循环（被 import 时可当协议库用）
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();

export { TOOLS, callTool };
