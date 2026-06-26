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
- Prefer foreground calls for short checks. Use `background: true` for long browser or full verification runs, then poll `qoder_status` and read `qoder_result`.
- If Qoder reports failure, Codex may fix the code and ask Qoder to retest. Stop automatic retest loops after two failed retests and report the remaining blocker.
- Read the structured summary first. Open full logs only when the summary is insufficient.

## Expected Result Handling

Qoder reports are meant for Codex consumption:

- `status` tells whether the run passed, failed, timed out, or violated policy.
- `summaryZh` is the human-readable Chinese summary.
- `keyOutput` and `keyErrors` contain only high-signal excerpts.
- `logFile` points to the full raw log.
- `patchFile` points to a generated test patch, when available.

Never claim Qoder verified the work unless the relevant tool result proves it.
