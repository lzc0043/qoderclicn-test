# qoderclicn-test Agent Rule Snippet

When using this repository's `qoderclicn-test` plugin:

- After Codex changes business logic, tests, build behavior, frontend interactions, or browser automation behavior, call Qoder verification before final delivery.
- Do not call Qoder for documentation-only, comment-only, or tiny non-runtime configuration changes.
- Qoder must not directly modify source files.
- If tests need to be added, ask Qoder to generate a patch proposal and let Codex inspect and apply it.
- Qoder reports should be consumed through structured summaries first; open full logs only when needed.
- If Qoder verification fails, Codex may fix and retest up to two times before stopping with a clear failure report.
