---
name: qoderclicn-test
description: Use when Codex has made code changes that need independent verification by Qoder CN CLI, including test patch generation, unit tests, browser automation tests, or final delivery validation.
---

# Qoder CN Test

Use this skill when a task touches business logic, tests, build behavior, frontend interaction, or browser automation behavior and needs independent verification before final delivery.

Do not use this skill for documentation-only changes, comment-only changes, or tiny configuration edits that do not affect runtime behavior.

## Rules

- Qoder must not directly modify the main workspace source files.
- Use `qoder_generate_test_patch` when test coverage is missing or when the user asks Qoder to write tests.
- Treat generated test code as a patch proposal saved under `.qoderclicn-test/patches/`; Codex must inspect and apply it if appropriate.
- Use `qoder_unit_test` for existing unit tests.
- Use `qoder_browser_test` for existing Playwright, Cypress, or equivalent browser automation tests.
- Use `qoder_web_screenshot` for URL screenshot tasks. It still routes through Qoder, with a constrained prompt so Qoder performs the browser automation and returns the screenshot path.
- Use `qoder_verify_changes` for final verification after Codex implements or fixes code.
- Qoder runs default to `permissionMode: "dont_ask"` while still denying `WRITE`; pass `model` explicitly when the user asks for a specific Qoder model such as `glm5.2`.
- Prefer foreground calls for short checks. Use `background: true` for long browser or full verification runs, then poll `qoder_status` and read `qoder_result`.
- If Qoder reports failure, Codex may fix the code and ask Qoder to retest. Stop automatic retest loops after two failed retests and report the remaining blocker.
- Read the structured summary first. Open full logs only when the summary is insufficient.

## Execution Order

1. Prefer the MCP tools when Codex exposes them: `qoder_check`, `qoder_unit_test`, `qoder_browser_test`, `qoder_verify_changes`, `qoder_generate_test_patch`, `qoder_web_screenshot`, `qoder_status`, `qoder_result`, `qoder_cancel`, and `qoder_cleanup`.
2. If the plugin is listed but the MCP tools are not callable, use the script fallback from this plugin root:

```powershell
node .\scripts\qoder-tool.mjs qoder_check --workspace "D:\path\to\workspace"
node .\scripts\qoder-tool.mjs qoder_unit_test --workspace "D:\path\to\workspace" --testCommand "npm.cmd test" --timeoutMs 600000
node .\scripts\qoder-tool.mjs qoder_verify_changes --workspace "D:\path\to\workspace" --model glm5.2 --timeoutMs 1200000
```

When the skill file is opened from `skills/qoderclicn-test/SKILL.md`, the plugin root is two directories above it. In Codex App, use an absolute path to `scripts/qoder-tool.mjs` if the current working directory is not the plugin root.

For complex arguments, pass JSON to avoid shell quoting issues:

```powershell
node .\scripts\qoder-tool.mjs qoder_unit_test --args-json '{"workspace":"D:\\path\\to\\workspace","testCommand":"npm.cmd run test --workspace @catp/ui","model":"glm5.2","timeoutMs":600000}'
```

The fallback prints the same structured JSON summary as the MCP tool. Treat `status`, `summaryZh`, `keyOutput`, `keyErrors`, `logFile`, and `patchFile` exactly the same way as MCP results.

## Expected Result Handling

Qoder reports are meant for Codex consumption:

- `status` tells whether the run passed, failed, timed out, or violated policy.
- `summaryZh` is the human-readable Chinese summary.
- `keyOutput` and `keyErrors` contain only high-signal excerpts.
- `logFile` points to the full raw log.
- `patchFile` points to a generated test patch, when available.

Never claim Qoder verified the work unless the relevant tool result proves it.
