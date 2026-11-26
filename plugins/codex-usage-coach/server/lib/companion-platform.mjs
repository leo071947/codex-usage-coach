import path from 'node:path';

export function companionCommand(platform, pluginRoot, { interval = 30, node = process.execPath, home } = {}) {
  const seconds = Math.max(10, Math.min(600, Math.round(Number(interval) || 30)));
  if (platform === 'win32') return {
    executable: 'cmd.exe',
    args: ['/d', '/s', '/c', `start "" powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "${path.join(pluginRoot, 'scripts', 'dial.ps1')}" -Interval ${seconds}`],
    windowsVerbatimArguments: true, readyTimeout: 5000,
  };
  if (platform === 'darwin') return {
    executable: '/bin/bash',
    args: [path.join(pluginRoot, 'scripts', 'macos', 'launch.sh'), '--node', node, '--home', home, '--interval', String(seconds)],
    windowsVerbatimArguments: false, readyTimeout: 60000,
  };
  throw new Error('桌宠支持 Windows 和 macOS；其他平台可使用用量工具与网页仪表盘。');
}
