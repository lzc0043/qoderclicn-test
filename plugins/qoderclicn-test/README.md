# qoderclicn-test

`qoderclicn-test` 是一个 Codex App 插件，用于让 Codex 在开发完成后调用 Qoder CN CLI（`qoderclicn`）进行独立测试验证。

插件目标是把“测试设计、测试建议、测试执行和浏览器自动化验证”交给 Qoder 处理，同时让 Codex 继续负责代码修改和最终决策。

## 工作流

1. Codex 实现功能或修复问题。
2. 如果测试覆盖不足，Qoder 生成测试 patch 建议。
3. Codex 审查 patch，确认合适后再应用到项目。
4. Qoder 以只读方式运行已有单元测试和浏览器自动化测试。
5. 如果测试失败，Codex 修复代码，再让 Qoder 复测；自动复测最多两轮。

## 安全模型

- Qoder 默认不得直接修改主工作区源码。
- Qoder 生成的测试代码只保存为 patch 文件，路径位于 `.qoderclicn-test/patches/`。
- Qoder 测试运行默认带 `--permission-mode dont_ask` 和 `--disallowed-tools=WRITE`，允许非交互执行只读测试命令，同时阻止写文件工具。
- 插件不指定模型时使用 Qoder CLI 自身默认模型；也可以通过工具参数 `model` 或环境变量 `QODER_MODEL` 显式指定，例如 `glm5.2`。
- 插件会记录 Qoder 执行前后的源码快照。如果发现源码变化，本次运行会标记为 `policy_violation`。
- 完整日志写入磁盘，Codex 默认只读取结构化摘要和日志路径，减少 token 消耗。

## 前置要求

- Node.js 18.18 或更高版本。
- 已安装并登录 Qoder CN CLI。
- Windows 下建议确保 `qoderclicn.cmd` 在 `PATH` 中。插件会优先查找 `qoderclicn.cmd`，再尝试 `qoderclicn.exe` / `qoderclicn`。如果 PATH 未配置，插件也会尝试默认安装位置 `%USERPROFILE%\.qoder-cn\bin\qoderclicn\qoderclicn.exe`。

可以先直接验证 Qoder：

```powershell
qoderclicn.cmd --version
```

## 本地开发安装

在仓库根目录执行：

```powershell
codex plugin marketplace add .
```

然后在 Codex App 的插件页面启用 `qoderclicn-test@personal`。如果 Codex App 提示需要重载插件，请按提示重启或重载。

部分 Codex CLI 版本没有 `codex plugin install` 子命令，只需要添加 marketplace 后在 App 中启用插件即可。

如果你的 Codex 版本要求显式传入 marketplace 文件路径，可以改用：

```powershell
codex plugin marketplace add .\.agents\plugins\marketplace.json
```

## 远程仓库安装

将当前仓库上传到远程后，可以按类似 `openai/codex-plugin-cc` 的方式安装 marketplace：

```powershell
codex plugin marketplace add <你的远程仓库或 marketplace 地址>
```

安装后重载插件，并在 Codex 中调用 `qoder_check` 验证 `qoderclicn` 是否可用。

## 脚本降级调用

如果 Codex App 已经识别到 `Qoder CN Test` 插件，但当前线程没有暴露 `qoder_check` 等 MCP 工具，可以直接使用插件脚本作为降级入口。脚本会调用同一套运行逻辑，并输出与 MCP 工具一致的结构化 JSON。

```powershell
node .\scripts\qoder-tool.mjs qoder_check --workspace "D:\path\to\workspace"
node .\scripts\qoder-tool.mjs qoder_unit_test --workspace "D:\path\to\workspace" --testCommand "npm.cmd test" --timeoutMs 600000
node .\scripts\qoder-tool.mjs qoder_verify_changes --workspace "D:\path\to\workspace" --model glm5.2 --timeoutMs 1200000
```

复杂参数建议使用 JSON，避免 PowerShell 引号转义干扰：

```powershell
node .\scripts\qoder-tool.mjs qoder_unit_test --args-json '{"workspace":"D:\\path\\to\\workspace","testCommand":"npm.cmd run test --workspace @catp/ui","model":"glm5.2","timeoutMs":600000}'
```

## MCP 工具

- `qoder_check`：检查 `qoderclicn.cmd` / `qoderclicn` 是否可用。
- `qoder_generate_test_patch`：让 Qoder 生成测试 patch，但不直接改源码。
- `qoder_unit_test`：让 Qoder 运行或验证项目已有单元测试。
- `qoder_browser_test`：让 Qoder 运行项目已有浏览器自动化测试。
- `qoder_verify_changes`：让 Qoder 综合验证 Codex 的当前改动。
- `qoder_web_screenshot`：让 Qoder 通过浏览器自动化截取网页截图，并返回截图路径。
- `qoder_status`：查询后台任务状态。
- `qoder_result`：读取后台任务结果，默认不返回完整日志。
- `qoder_cancel`：取消后台任务。
- `qoder_cleanup`：清理旧日志、报告、patch 和任务文件。

## 运行数据

插件会在被验证项目内写入运行数据：

```text
.qoderclicn-test/
  patches/
  reports/
  logs/
  jobs/
```

该目录应保持在 `.gitignore` 中。插件默认保留最近 30 次运行记录，并将受管文件总量限制在 500MB 内。

## 验证插件

在仓库根目录执行：

```powershell
npm.cmd test
npm.cmd run validate:plugin
```

Windows 下请优先使用 `.cmd` 入口，避免 PowerShell 执行策略拦截 `.ps1` 包装脚本。
