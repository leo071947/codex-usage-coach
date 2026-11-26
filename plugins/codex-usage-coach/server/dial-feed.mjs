#!/usr/bin/env node
// 表盘数据泵：定期把最新用量写进 ~/.codex/usage-coach/dial.json，供 PowerShell 悬浮表盘读取。
// 用法：
//   node server/dial-feed.mjs                # 常驻，默认 30 秒刷新一次
//   node server/dial-feed.mjs --once         # 只写一次就退出（自测用）
//   node server/dial-feed.mjs --interval=60  # 自定义刷新秒数
import fs from 'node:fs';
import path from 'node:path';
import { collect } from './lib/collect.mjs';
import { dialState } from './lib/dial.mjs';
import { appendLog, ensureDir, locations, writeFileAtomic } from './lib/paths.mjs';

const once = process.argv.includes('--once');
const intervalArg = process.argv.find((a) => a.startsWith('--interval='));
const requested = intervalArg ? Number(intervalArg.split('=')[1]) : 0;

function log(line) {
  try {
    appendLog(`[dial-feed] ${line}`);
  } catch {
    /* 忽略 */
  }
}

let timer = null;
let stopping = false;
let failures = 0;

async function tick() {
  const startedAt = Date.now();
  try {
    const state = await collect({});
    const payload = dialState(state);
    const interval = requested > 0 ? requested : Math.max(10, Math.min(600, Math.round((state.config.autoRefreshSec || 15) * 2)));
    payload.feed = { intervalSec: interval, wroteAt: Date.now(), durationMs: Date.now() - startedAt, error: null };
    ensureDir(path.dirname(locations.dial()));
    writeFileAtomic(locations.dial(), JSON.stringify(payload, null, 2));
    failures = 0;
    return interval;
  } catch (err) {
    failures += 1;
    const interval = requested > 0 ? requested : 30;
    try {
      // Preserve the last successful readings if a refresh fails; never turn
      // a temporary scanner error into a fabricated zero quota.
      let previous = {};
      try { previous = JSON.parse(fs.readFileSync(locations.dial(), 'utf8')); } catch { }
      const fallback = {
        ...previous,
        version: 1,
        generatedAt: previous.generatedAt ?? null,
        error: String(err?.message || err),
        feed: { intervalSec: interval, wroteAt: Date.now(), durationMs: Date.now() - startedAt, error: String(err?.message || err) },
      };
      ensureDir(path.dirname(locations.dial()));
      writeFileAtomic(locations.dial(), JSON.stringify(fallback, null, 2));
    } catch {
      /* 忽略 */
    }
    log(`刷新失败（第 ${failures} 次）：${err?.message || err}`);
    return interval;
  }
}

async function loop() {
  const interval = await tick();
  if (once || stopping) return;
  timer = setTimeout(loop, Math.max(5, interval) * 1000);
}

function shutdown(code = 0) {
  stopping = true;
  if (timer) clearTimeout(timer);
  try {
    if (fs.existsSync(locations.dialPid())) fs.rmSync(locations.dialPid(), { force: true });
  } catch {
    /* 忽略 */
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (!once) {
  try {
    ensureDir(path.dirname(locations.dialPid()));
    fs.writeFileSync(locations.dialPid(), String(process.pid), 'utf8');
  } catch {
    /* 忽略 */
  }
}

loop().catch((err) => {
  log(`数据泵启动失败：${err?.message || err}`);
  shutdown(1);
});
