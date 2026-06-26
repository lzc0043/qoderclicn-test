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

## 本地安装

在仓库根目录执行：

```powershell
codex plugin marketplace add .
codex plugin install qoderclicn-test@personal
```

如果 Codex 版本要求显式 marketplace 文件路径：

```powershell
codex plugin marketplace add .\.agents\plugins\marketplace.json
codex plugin install qoderclicn-test@personal
```
