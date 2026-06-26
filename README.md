# qoderclicn-test

Codex App 插件，用于让 Codex 调用 Qoder CN CLI (`qoderclicn`) 进行独立测试验证、测试 patch 生成、后台任务管理和网页截图。

插件主体位于：

```text
plugins/qoderclicn-test/
```

使用说明见：

```text
plugins/qoderclicn-test/README.md
```

## 本地验证

```powershell
npm.cmd test
npm.cmd run validate:plugin
```

## MCP 不可见时的降级验证

如果 Codex 已安装插件但当前线程没有暴露 `qoder_check`，可以直接调用插件脚本：

```powershell
node .\plugins\qoderclicn-test\scripts\qoder-tool.mjs qoder_check --workspace "D:\path\to\workspace"
```

## 本地安装

在仓库根目录执行：

```powershell
codex plugin marketplace add .
```

然后在 Codex App 的插件页面启用 `qoderclicn-test@personal`。部分 Codex CLI 版本没有 `codex plugin install` 子命令，只需要添加 marketplace 后在 App 中启用插件即可。

如果 Codex 版本要求显式 marketplace 文件路径：

```powershell
codex plugin marketplace add .\.agents\plugins\marketplace.json
```
