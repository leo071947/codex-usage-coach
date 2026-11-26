# Codex 用量管家 · Usage Coach

本地 Codex 用量监控插件，附带跟随输入框行走的像素猫咪。

**Local Codex usage monitoring with a pixel cat companion for Windows and a macOS native source implementation.** No API key or additional login is required. The companion supports Chinese and English.

macOS 实现目前为**待实机验收的源码版本**：已提供原生窗口、权限引导、自动定位与生命周期实现；当前开发环境为 Windows，尚未在 Mac 上完成编译和交互验证。仓库中的 GitHub Actions 会在推送后执行 macOS 编译与非交互自测，不代表已验证真实 Codex 输入框、辅助功能授权或多屏行为。

## 功能

- 自动读取本机 Codex 的周额度、5 小时窗口、重置时间与 token 消耗。
- 像素猫咪自动定位 Codex 输入框，随窗口移动；切到其他应用或最小化时隐藏，Codex 关闭后退出。
- 停步时，青色和粉紫气泡从猫咪头顶错峰上浮，显示 5 小时及本周剩余百分比；内部填充表示余量，长大后爆开。
- 气泡发出后与猫咪分离，保留出生点。右键详情在猫咪头顶展开；支持拖动、关闭动效和中英文切换。
- 提供网页仪表盘、历史用量和 Markdown 报告。

桌宠是 Windows 透明附着窗口，并非注入 Codex 内部的组件。自动启动发生在 Codex 加载本插件的 MCP 服务时；客户端延迟加载服务时，猫咪也会延迟出现。

## 环境要求

- Windows 10/11，Windows PowerShell 5.1、.NET Framework 和可正常运行的 Codex 桌面版。
- Node.js 18+，`node` 需要在 Codex 进程的 PATH 中。MCP 使用同一份跨平台 Node 入口；修改 PATH 后请重启 Codex。
- Codex CLI 支持 `plugin marketplace` 和 `plugin add`。

Windows 使用 PowerShell/.NET；macOS 使用 Swift/AppKit，要求 macOS 12+、Xcode Command Line Tools 和辅助功能权限。源码在本机编译，Intel 与 Apple Silicon 分别生成对应架构，不提供未经验证的预编译安装包。无需安装 npm 依赖。

## macOS 安装与启动（源码版）

下载完整仓库后，在终端进入仓库目录：

```bash
bash install-macos.sh
```

安装器要求 `node` 和 `codex` 在 PATH 中；Codex CLI 路径也可通过 `CODEX_CLI_PATH` 指定。首次本机编译需要 Xcode Command Line Tools，未安装时运行 `xcode-select --install` 并完成系统安装提示。编译成功后注册同一个本地市场和插件，无需另建 Mac 仓库。

也可直接测试猫咪，无需先注册插件：

```bash
bash start-macos.sh
```

首次打开时，在 **系统设置 → 隐私与安全性 → 辅助功能** 中允许 **Codex Usage Cat**。菜单栏 `CAT` 菜单提供权限设置入口、语言、动效和退出；授权由用户操作，程序不会替你修改系统权限。找不到输入框时隐藏，不使用猜测坐标。代码只读取控件名称、类型与几何位置，不读取输入框内容。

运行时生成在 `${CODEX_HOME:-~/.codex}/usage-coach/runtime/CodexUsageCat.app`，编译日志在 `usage-coach/mac-build.log`。这是本机编译、临时签名的开发应用，不是 Apple 公证发行包；更新二进制后系统可能需要重新授予辅助功能权限。

Mac 客户端复用相同 121 帧、12 fps 行走停步、左右错峰上浮爆裂和进度填充；使用原生 macOS 菜单。窗口保持普通层级，仅 Codex 在前台时出现，退出 Codex 后关闭数据泵并退出。用 `bash uninstall-macos.sh` 移除插件，默认保留使用数据和编译缓存。

## 下载和安装

从 GitHub 下载仓库 ZIP 并解压，或克隆仓库。打开 PowerShell，进入解压后的 `codex-usage-coach` 目录：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

脚本将当前目录注册为本地插件市场 `lucky-usage`，然后安装插件。找不到 Codex CLI 时可显式指定：

```powershell
.\install.ps1 -CodexExe "C:\path\to\codex.exe"
```

安装后重新加载插件或重启 Codex。在聊天中说「打开猫咪桌宠」即可请求启动，也可以直接从本目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-dial.ps1
```

**English quick start:** Windows: run `install.ps1` or `start-dial.ps1`. macOS source preview: install Node.js 18+, the Codex CLI, and Xcode Command Line Tools, then run `bash install-macos.sh` or `bash start-macos.sh`; grant Accessibility access to Codex Usage Cat. Reload the plugin in Codex. Right-click the cat to choose English. Keep the extracted directory available for local marketplace updates. Mac compilation and UI acceptance are pending until the macOS CI job and a real Mac test pass.

若插件缓存更新提示“拒绝访问”，先关闭 Codex 和正在运行的猫咪，再重新执行安装。更新仓库文件后需重新安装或刷新插件缓存，已加载的旧进程不会自动热更新。

## 使用

| 请求 | 工具 |
| --- | --- |
| 还剩多少额度、什么时候重置 | `usage_status` |
| 今天建议用多少 | `daily_plan` |
| 最近几天的用量 | `usage_history` |
| 打开猫咪 / 关闭猫咪 | `show_dial` / `hide_dial` |
| 打开网页仪表盘 | `open_dashboard` |
| 导出报告 | `write_usage_report` |
| 调整预算、时区等 | `configure` |

猫咪的右键详情使用本地头顶卡片；只有主动调用 `open_dashboard` 才打开网页。右键可暂停刷新、关闭动效、切换语言或退出。

## 数据和隐私

所有分析在本机离线进行，不上传数据：

- 默认读取 `~/.codex/sessions` 和 `~/.codex/archived_sessions` 中的用量事件。
- 从当前 Codex 主目录的 `auth.json` 本地解析套餐及账号，仅显示脱敏邮箱。
- 用 `CODEX_HOME` 指向其他 Codex 主目录；`USAGE_COACH_SESSIONS` 可追加日志目录。
- 缓存、报告、语言偏好及诊断状态写到当前 Codex 主目录下的 `usage-coach`，不写入仓库。
- 自动定位只读取 Windows 无障碍控件的类型、名称和位置，不读取输入框内容。

官方额度百分比来自日志里的快照。token 余额按历史样本折算，是估算值；今日建议预算是插件的规划值，**不等于官方额度**，建议预算为 0 不代表无法继续使用 Codex。快照过旧或同步失败时，详情会保留快照时间或旧数据；没有快照时显示 `—`。

本机日志可能包含多个账号或多个会话的消耗，无法完整按账号隔离。该工具不能替代官方用量页面。

## 配置与排查

配置在 `~/.codex/usage-coach/config.json`，可通过 `configure` 工具修改。常用配置：`reservePct`（默认 10）、`timeZone`、`dailyTokenCap`、`windowHours`（默认 5）、`historyDays`（默认 14）、`autoRefreshSec`。

- **猫咪没出现：** 确认 Codex 在前台且输入框可见。插件尚未加载时可手动运行 `start-dial.ps1`。找不到输入框时会隐藏并继续检测，不使用猜测坐标。
- **检查定位：** `usage-coach/pet-anchor-status.json` 中 `found: true`、`status: "uia"` 表示已定位。桌面版升级可能改变无障碍控件结构。
- **检查错误：** 查看 `usage-coach/dial-error.log` 和 `coach.log`。
- **禁止自动启动：** 在 MCP 服务环境变量中设置 `USAGE_COACH_AUTO_PET=0`；之后仍可手动启动。
- **关闭后仍有进程：** 关闭 Codex 的隐藏主窗口可能与退出整个应用不同；猫咪跟随实际 Codex 窗口生命周期，并在检测不到宿主后约 5 秒退出。

## 开发与验证

```powershell
npm test
npm run test:windows
```

`npm test` 使用临时生成的样例日志，覆盖扫描、额度推算、预算和 MCP 工具，不读取个人账号或修改真实 Codex 配置。Windows 测试验证 PowerShell 语法、原生代码编译、行走停步时间轴和离线渲染，也不启动真实猫咪窗口。

可选的运行时诊断：猫咪已运行且 Codex 在前台时，执行 `tests/bubble-detachment.ps1`，只读采样猫咪和气泡坐标，检查行走是否带动气泡。

```text
codex-usage-coach/
├─ .agents/plugins/marketplace.json
├─ plugins/codex-usage-coach/
│  ├─ .codex-plugin/plugin.json
│  ├─ .mcp.json
│  ├─ assets/                 # 图标、121 帧猫咪和图片许可
│  ├─ scripts/                # Windows 窗口、行走和定位
│  │  └─ macos/              # Swift/AppKit 客户端与本机编译
│  ├─ server/                 # MCP、数据泵、扫描和预算
│  └─ skills/usage-coach/
├─ tests/
├─ install.ps1 / uninstall.ps1 / start-dial.ps1
├─ install-macos.sh / start-macos.sh / uninstall-macos.sh
├─ .github/workflows/ci.yml  # Windows/macOS/Linux 核心验证和 Mac 编译
├─ LICENSE
└─ package.json
```

## 卸载

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

默认保留本地数据。确定不再需要时可加 `-PurgeData` 删除本工具的数据目录。

## 许可

代码及文档：[MIT](LICENSE)。猫咪图片：**仅限个人非商业使用**，详见 [图片许可](plugins/codex-usage-coach/assets/lv1/ASSET-LICENSE.md)。代码的 MIT 许可不包含猫咪图片的商业授权。
