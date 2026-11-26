// 会话日志扫描：把 ~/.codex/sessions 下的 rollout-*.jsonl 增量解析成用量点。
// 只解析包含 "token_count" 的行，其余行直接跳过（806MB 语料下仍然很快）。
import fs from 'node:fs';
import path from 'node:path';
import { locations, sessionRoots, writeFileAtomic } from './paths.mjs';

const CACHE_VERSION = 1;

/**
 * 逐行读取文件的异步生成器，返回完整行和该行结束后的绝对字节偏移。
 * 未以换行结尾的尾部残行不会被产出（偏移量也不会前进），保证下次可以续读。
 */
export async function* readLines(filePath, startOffset = 0) {
  const stream = fs.createReadStream(filePath, { start: startOffset, highWaterMark: 1 << 20 });
  let pending = [];
  let pendingLen = 0;
  let lineStart = startOffset;
  try {
    for await (const chunk of stream) {
      let i = 0;
      for (;;) {
        const nl = chunk.indexOf(0x0a, i);
        if (nl === -1) {
          if (i < chunk.length) {
            pending.push(chunk.subarray(i));
            pendingLen += chunk.length - i;
          }
          break;
        }
        const seg = chunk.subarray(i, nl);
        let lineBuf;
        if (pendingLen === 0) {
          lineBuf = seg;
        } else {
          pending.push(seg);
          lineBuf = Buffer.concat(pending, pendingLen + seg.length);
          pending = [];
          pendingLen = 0;
        }
        const endOffset = lineStart + lineBuf.length + 1;
        yield { line: lineBuf.toString('utf8'), endOffset };
        lineStart = endOffset;
        i = nl + 1;
        if (i > chunk.length) break;
      }
    }
  } finally {
    stream.destroy();
  }
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
}

/** 发现所有会话日志；同一文件名（会话 UUID）只保留一份，避免归档副本被重复统计 */
export function discoverSessionFiles() {
  const all = [];
  for (const root of sessionRoots()) walk(root, all);
  const groups = new Map();
  for (const file of all) {
    const key = path.basename(file);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  const result = [];
  for (const [, files] of groups) {
    if (files.length === 1) {
      result.push(files[0]);
      continue;
    }
    const sizes = new Set(files.map((f) => statSize(f)));
    if (sizes.size === 1) {
      const preferred = files.find((f) => f.includes(`${path.sep}sessions${path.sep}`)) ?? files[0];
      result.push(preferred);
    } else {
      result.push(...files);
    }
  }
  return result.sort();
}

function statSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return -1;
  }
}

function emptyCache() {
  return { version: CACHE_VERSION, updatedAt: 0, files: {} };
}

export function loadCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(locations.cache(), 'utf8'));
    if (!raw || raw.version !== CACHE_VERSION || typeof raw.files !== 'object') return emptyCache();
    return raw;
  } catch {
    return emptyCache();
  }
}

export function saveCache(cache) {
  writeFileAtomic(locations.cache(), JSON.stringify(cache));
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 从一行 token_count 事件里提取用量点 */
export function parseTokenCountLine(line) {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  const payload = obj && obj.payload;
  if (!payload || payload.type !== 'token_count') return null;
  const info = payload.info || {};
  const last = info.last_token_usage || info.total_token_usage || null;
  if (!last) return null;
  const tsRaw = obj.timestamp ?? payload.timestamp;
  const ts = typeof tsRaw === 'number' ? tsRaw : Date.parse(tsRaw ?? '');
  if (!Number.isFinite(ts)) return null;
  const rl = payload.rate_limits || null;
  const primary = rl && rl.primary ? rl.primary : null;
  const secondary = rl && rl.secondary ? rl.secondary : null;
  const point = {
    t: ts,
    tk: Math.max(0, Math.round(Number(last.total_tokens) || 0)),
    ip: Math.max(0, Math.round(Number(last.input_tokens) || 0)),
    cn: Math.max(0, Math.round(Number(last.cached_input_tokens) || 0)),
    op: Math.max(0, Math.round(Number(last.output_tokens) || 0)),
    rs: Math.max(0, Math.round(Number(last.reasoning_output_tokens) || 0)),
    p5: primary ? numOrNull(primary.used_percent) : null,
    r5: primary ? numOrNull(primary.resets_at) : null,
    pw: secondary ? numOrNull(secondary.used_percent) : null,
    rw: secondary ? numOrNull(secondary.resets_at) : null,
  };
  if (point.tk === 0 && point.p5 == null && point.pw == null) return null;
  return point;
}

/**
 * 扫描（增量）所有会话日志。
 * @returns {Promise<{points:Array, stats:object, cache:object}>}
 */
export async function scanUsage({ config, force = false, now = Date.now() } = {}) {
  const startedAt = Date.now();
  const budget = Math.max(1000, Number(config?.scanBudgetMs ?? 45000));
  const cache = force ? emptyCache() : loadCache();
  const files = discoverSessionFiles();
  const keep = new Set(files);
  for (const known of Object.keys(cache.files)) {
    if (!keep.has(known)) delete cache.files[known];
  }

  let scannedFiles = 0;
  let bytesRead = 0;
  let newPoints = 0;
  let partial = false;
  let timedOut = false;

  for (const file of files) {
    if (Date.now() - startedAt > budget) {
      partial = true;
      timedOut = true;
      break;
    }
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    let state = cache.files[file];
    if (!state || !Array.isArray(state.points)) {
      state = { size: -1, mtimeMs: -1, offset: 0, points: [] };
      cache.files[file] = state;
    }
    if (st.size < state.offset || st.size < state.size) {
      // 文件被截断/重写，重头再来
      state = { size: -1, mtimeMs: -1, offset: 0, points: [] };
      cache.files[file] = state;
    }
    const unchanged = st.size === state.size && Math.abs(st.mtimeMs - state.mtimeMs) < 1 && state.size >= 0;
    if (unchanged && !force) continue;

    const startOffset = state.offset;
    let interrupted = false;
    let lineCount = 0;
    try {
      for await (const { line, endOffset } of readLines(file, state.offset)) {
        state.offset = endOffset;
        lineCount += 1;
        if (lineCount % 4000 === 0 && Date.now() - startedAt > budget) {
          // 超大文件：到点先停，已读偏移已记录，下次从断点续读
          interrupted = true;
          partial = true;
          timedOut = true;
          break;
        }
        if (!line.includes('"token_count"')) continue;
        const point = parseTokenCountLine(line);
        if (!point) continue;
        state.points.push(point);
        newPoints += 1;
      }
      if (!interrupted) {
        state.size = st.size;
        state.mtimeMs = st.mtimeMs;
        scannedFiles += 1;
      }
      bytesRead += Math.max(0, state.offset - startOffset);
    } catch (err) {
      partial = true;
      state.size = -1; // 下次重试
      if (process.env.USAGE_COACH_DEBUG) process.stderr.write(`[usage-coach] 扫描失败 ${file}: ${err}\n`);
    }
  }

  // 汇总 + 排序 + 按保留期裁剪
  const retention = Math.max(7, Number(config?.retentionDays ?? 400)) * 86400000;
  const cutoff = now - retention;
  const merged = [];
  for (const [file, state] of Object.entries(cache.files)) {
    if (!state.points || state.points.length === 0) continue;
    if (state.points[state.points.length - 1].t < cutoff) {
      state.points = state.points.filter((p) => p.t >= cutoff);
    }
    for (const p of state.points) merged.push(p);
  }
  merged.sort((a, b) => a.t - b.t || a.tk - b.tk);

  cache.updatedAt = now;
  try {
    saveCache(cache);
  } catch {
    /* 缓存写失败不影响本次结果 */
  }

  return {
    points: merged,
    stats: {
      files: files.length,
      scannedFiles,
      bytesRead,
      newPoints,
      totalPoints: merged.length,
      durationMs: Date.now() - startedAt,
      partial,
      timedOut,
      cachePath: locations.cache(),
    },
    cache,
  };
}

/** 最近一次活动时间 */
export function lastActivityAt(points) {
  return points.length ? points[points.length - 1].t : null;
}
