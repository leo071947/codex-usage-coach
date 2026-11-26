// 路径解析：所有路径都基于本机 Codex 主目录（默认 ~/.codex，可用 CODEX_HOME 覆盖）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function codexHome() {
  const env = process.env.CODEX_HOME;
  if (env && env.trim()) return path.resolve(env.trim());
  return path.join(os.homedir(), '.codex');
}

/** 插件自己的数据目录：~/.codex/usage-coach */
export function coachHome() {
  return path.join(codexHome(), 'usage-coach');
}

export const locations = {
  codexHome,
  coachHome,
  config: () => path.join(coachHome(), 'config.json'),
  cache: () => path.join(coachHome(), 'cache.json'),
  reports: () => path.join(coachHome(), 'reports'),
  dashboard: () => path.join(coachHome(), 'dashboard.html'),
  dashboardData: () => path.join(coachHome(), 'dashboard.json'),
  dial: () => path.join(coachHome(), 'dial.json'),
  dialPid: () => path.join(coachHome(), 'dial.pid'),
  log: () => path.join(coachHome(), 'coach.log'),
};

/** 会话日志所在目录（正常 + 归档；可用 USAGE_COACH_SESSIONS 追加自定义目录） */
export function sessionRoots() {
  const home = codexHome();
  const roots = [path.join(home, 'sessions'), path.join(home, 'archived_sessions')];
  const extra = process.env.USAGE_COACH_SESSIONS;
  if (extra && extra.trim()) {
    for (const part of extra.split(path.delimiter)) {
      if (part.trim()) roots.push(path.resolve(part.trim()));
    }
  }
  return roots;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 原子写入文本（先写临时文件再改名，避免半截文件） */
export function writeFileAtomic(file, content) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    try {
      fs.copyFileSync(tmp, file);
      fs.rmSync(tmp, { force: true });
    } catch {
      /* 忽略：下次写入会覆盖 */
    }
  }
}

/** 追加日志（最多保留 ~200KB） */
export function appendLog(line) {
  try {
    const file = locations.log();
    ensureDir(path.dirname(file));
    const ts = new Date().toISOString();
    fs.appendFileSync(file, `[${ts}] ${line}\n`, 'utf8');
    const st = fs.statSync(file);
    if (st.size > 200 * 1024) {
      const text = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, text.slice(-100 * 1024), 'utf8');
    }
  } catch {
    /* 日志失败不能影响主流程 */
  }
}
