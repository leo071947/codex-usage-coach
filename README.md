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

Windows 使用透明附着窗口，macOS 使用原生透明面板；两者均为独立进程。自动启动发生在 Codex 加载本插件的 MCP 服务时；客户端延迟加载服务时，猫咪也会延迟出现。

## 环境要求

- Windows 10/11，Windows PowerShell 5.1、.NET Framework 和可正常运行的 Codex 桌面版。
- Node.js 18+，`node` 需要在 Codex 进程的 PATH 中。MCP 使用同一份跨平台 Node 入口；修改 PATH 后请重启 Codex。
- Codex CLI 支持 `plugin marketplace` 和 `plugin add`。

Windows 使用 PowerShell/.NET；macOS 使用 Swift/AppKit，要求 macOS 12+、Xcode Command Line Tools 和辅助功能权限。源码在本机编译，Intel 与 Apple Silicon 分别生成对应架构，不提供未经验证的预编译安装包。无需安装 npm 依赖。

## macOS 下载和安装（源码版）

Windows 和 Mac 使用**同一个仓库、同一份 ZIP**，不需要分别建立仓库。当前没有可直接拖进「应用程序」的 `.dmg` 安装包，首次安装需要在 Mac 终端运行脚本，由本机编译猫咪应用。macOS 编译和实机验证状态见 [Mac 验收说明](docs/macos-testing.md)。

### 1. 下载完整仓库

1. 打开 [GitHub 仓库](https://github.com/lei071947/codex-usage-coach)。
2. 点击绿色 **Code → Download ZIP**，双击下载的 ZIP 解压。
3. 将解压文件夹放到固定位置，例如「文稿」。文件夹名可能是 `codex-usage-coach-main`，里面应有 `install-macos.sh`、`plugins`、`.agents` 和 `README.md`；Finder 默认隐藏点开头的目录，可用 `Command + Shift + .` 查看。

请保留完整文件夹。安装器将它注册为本地插件市场，后续更新仍需要使用它。

### 2. 安装依赖（首次需要）

- 安装并登录 Codex 桌面版。
- 安装适用于当前 macOS 的 [Node.js](https://nodejs.org/en/download)（18 或更高版本，包含 npm），然后重新打开终端；修改 PATH 后也要重启 Codex。
- 打开「终端」，检查 Node，并安装或更新 Codex CLI：

```bash
node --version
npm install -g @openai/codex@latest
codex --version
codex plugin --help
```

CLI 安装命令依据 [OpenAI 官方文档](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)。如果已安装且 `codex plugin --help` 正常，可以跳过 npm 安装。不要因为 npm 权限报错就使用 `sudo`；应先修正 Node 安装方式或 npm 的用户目录。

本机编译还需要 Apple 命令行开发工具：

```bash
xcode-select --install
```

完成系统弹窗中的安装后再继续；提示已经安装则可跳过。无需安装完整 Xcode，也无需在此仓库执行 `npm install`。

### 3. 进入目录并安装

在终端输入 `cd` 加一个空格，把解压的**整个文件夹**从 Finder 拖到终端，再按回车。随后执行：

```bash
bash install-macos.sh
```

脚本先编译本机架构的 App，再注册 `lucky-usage` 本地市场、安装插件并列出结果。Apple Silicon 和 Intel 使用同样的步骤。安装成功后重启 Codex；插件 MCP 服务加载时会启动猫咪。

如果暂时只想测试猫咪，可在同一目录执行：

```bash
bash start-macos.sh
```

手动启动时应保持 Codex 正在运行；检测不到 Codex 时，猫咪会在约 5 秒后退出。

### 4. 授予辅助功能权限

1. 启动后找到菜单栏的 **CAT → 辅助功能设置**，或打开 **系统设置 → 隐私与安全性 → 辅助功能**（macOS 12 位于「系统偏好设置 → 安全性与隐私 → 隐私」）。
2. 启用 **Codex Usage Cat**。若列表中没有它，点击 `+`，按 `Command + Shift + G`，输入下面目录并选择其中的 App：

```text
~/.codex/usage-coach/runtime/CodexUsageCat.app
```

3. 回到 Codex，打开有输入框的聊天。权限生效后猫咪才会显示；必要时退出猫咪，再运行 `bash start-macos.sh`。

使用自定义 `CODEX_HOME` 时，App 在该目录下的 `usage-coach/runtime`。这是本机编译并临时签名的开发应用，尚非 Apple 公证安装包；更新后系统可能要求重新授权。程序只读取控件名称、类型和位置，不读取输入框内容。

### 5. 确认安装成功

- 安装命令正常结束，插件列表中出现 `codex-usage-coach`。
- Codex 在前台且输入框可见时，猫咪沿输入框行走；切换其他应用或最小化 Codex 时隐藏，退出 Codex 后退出。
- 停步时显示两个错峰上浮、放大和爆裂的像素气泡；右键「查看余量详情」在猫咪头顶展开卡片。
- 额度优先查询当前账号，默认约每 30 秒刷新；详情出现「账户额度实时查询」表示使用账户接口。回退日志时标注来源，过期数据带 `~`，没有数据为 `—`。不需要另填 API Key。
- 右键或 CAT 菜单可切换中文 / English、动效和退出。Mac 使用系统原生菜单。

### 更新与卸载

先从 CAT 菜单退出猫咪并完全退出 Codex，下载新 ZIP，把**完整仓库内容（包含隐藏目录）**更新到原固定目录，再在该目录重新运行 `bash install-macos.sh`，完成后重启 Codex。若改了存放位置，应先在旧目录卸载，再从新目录安装。不要只更新 README 或 Swift 单个文件，额度读取还依赖共享 Node 代码。

```bash
bash uninstall-macos.sh
```

卸载默认保留 `~/.codex/usage-coach` 内的数据和编译缓存。安装器能自动尝试 `/Applications/Codex.app/Contents/Resources/codex`；找不到 CLI 时可指定实际可执行文件：

```bash
CODEX_CLI_PATH="/实际路径/codex" bash install-macos.sh
CODEX_CLI_PATH="/实际路径/codex" bash start-macos.sh
```

建议把 `codex` 安装到 PATH 中，使重启 Codex 后的自动启动和额度查询也能找到它。手动指定变量只对本次命令有效。

### Mac 常见问题

| 现象 | 处理方式 |
| --- | --- |
| `node` / `codex` 找不到 | 检查上述版本命令；安装依赖后重新打开终端和 Codex。 |
| `xcrun` / `swiftc` 报错 | 完成 `xcode-select --install` 后重试；查看 `~/.codex/usage-coach/mac-build.log`。 |
| 已安装但没猫咪 | 保持 Codex 在前台、输入框可见；检查辅助功能权限并尝试 `bash start-macos.sh`。 |
| 有猫咪但额度旧 | 检查网络、CLI 与桌面版是否使用相同账号和 `CODEX_HOME`；查看详情来源与 `usage-coach/coach.log`。 |
| 更新后不出现 | 确认插件缓存已更新、旧进程已退出；在辅助功能中重新授权新编译的 App。 |

## Windows 下载和安装

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

日志分析在本机进行。额度刷新优先通过本机 Codex app-server 的官方只读 `account/rateLimits/read` 接口，需要联网；不创建任务、不调用模型、不上传会话内容。接口不可用时回退到日志快照，详情标注来源，旧快照以 `~` 提示可能延迟。设置 `USAGE_COACH_LIVE_LIMITS=0` 可关闭联网额度读取。

- 默认读取 `~/.codex/sessions` 和 `~/.codex/archived_sessions` 中的用量事件。
- 从当前 Codex 主目录的 `auth.json` 本地解析套餐及账号，仅显示脱敏邮箱。
- 用 `CODEX_HOME` 指向其他 Codex 主目录；`USAGE_COACH_SESSIONS` 可追加日志目录。
- 缓存、报告、语言偏好及诊断状态写到当前 Codex 主目录下的 `usage-coach`，不写入仓库。
- 自动定位只读取 Windows / macOS 无障碍控件的类型、名称和位置，不读取输入框内容。

额度百分比优先来自账户只读接口，不可用时来自日志快照。token 余额按历史样本折算，是估算值；今日建议预算是插件的规划值，**不等于官方额度**，建议预算为 0 不代表无法继续使用 Codex。快照过旧或同步失败时会保留旧数据并标注可能延迟；没有快照时显示 `—`。

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
