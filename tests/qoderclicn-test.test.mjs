import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";

import {
  DATA_DIR_NAME,
  checkQoder,
  cleanupWorkspace,
  getJobResult,
  getJobStatus,
  resolveQoderCommand,
  runQoder,
  runTool
} from "../plugins/qoderclicn-test/scripts/lib/qoder-runner.mjs";

function makeTempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qoderclicn-test-"));
  fs.writeFileSync(path.join(root, "app.js"), "export const value = 1;\n", "utf8");
  return root;
}

function installFakeQoder(binDir, behavior = "success") {
  fs.mkdirSync(binDir, { recursive: true });
  const scriptPath = path.join(binDir, "fake-qoder.mjs");
  const source = `
import fs from "node:fs";
import path from "node:path";
const behavior = ${JSON.stringify(behavior)};
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("qoderclicn fake 1.0.0");
  process.exit(0);
}
if (behavior === "timeout") {
  setTimeout(() => {}, 10000);
} else if (behavior === "invalid-json") {
  console.log("not json");
} else if (behavior === "failure") {
  console.error("unit test failed");
  console.log(JSON.stringify({ result: "测试失败：expected true to be false" }));
  process.exit(1);
} else if (behavior === "pass-with-zero-fail") {
  console.log(JSON.stringify({ result: "验证结论：全部通过。10 pass / 0 fail。建议：未来补充失败路径测试。" }));
} else if (behavior === "screenshot-success-with-no-failure") {
  console.log(JSON.stringify({ result: "截图已成功获取，页面正常加载。无错误、无失败用例。" }));
} else if (behavior === "web-screenshot") {
  const cwdIndex = args.indexOf("-w");
  const workspace = cwdIndex >= 0 ? args[cwdIndex + 1] : process.cwd();
  const screenshotPath = path.join(workspace, ".qoderclicn-test", "logs", "qoder-web-shot.png");
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, "fake qoder screenshot");
  console.log(JSON.stringify({ result: "截图已成功获取。Screenshot path: " + screenshotPath }));
} else if (behavior === "patch") {
  console.log(JSON.stringify({ result: "diff --git a/tests/app.test.js b/tests/app.test.js\\nnew file mode 100644\\n--- /dev/null\\n+++ b/tests/app.test.js\\n@@ -0,0 +1,2 @@\\n+import { value } from '../app.js';\\n+test('value', () => expect(value).toBe(1));" }));
} else {
  console.log(JSON.stringify({ result: "全部测试通过" }));
}
`;
  fs.writeFileSync(scriptPath, source, "utf8");
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(binDir, "qoderclicn.cmd"), `@echo off\r\nnode "%~dp0fake-qoder.mjs" %*\r\n`, "utf8");
  } else {
    const shPath = path.join(binDir, "qoderclicn");
    fs.writeFileSync(shPath, `#!/usr/bin/env sh\nnode "${scriptPath}" "$@"\n`, "utf8");
    fs.chmodSync(shPath, 0o755);
  }
}

function envWithFake(binDir) {
  return {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
  };
}

test("qoder_check detects fake qoderclicn", async () => {
  const workspace = makeTempWorkspace();
  const binDir = path.join(workspace, "bin");
  installFakeQoder(binDir);

  const result = await checkQoder({ workspace, env: envWithFake(binDir) });

  assert.equal(result.available, true);
  assert.match(result.version, /qoderclicn fake/);
  if (process.platform === "win32") {
    assert.match(result.command, /qoderclicn\.cmd$/i);
  }
});

test("resolver detects default qoder-cn installation path when PATH misses it", () => {
  if (process.platform !== "win32") {
    return;
  }
  const workspace = makeTempWorkspace();
  const fakeHome = path.join(workspace, "home");
  const binDir = path.join(fakeHome, ".qoder-cn", "bin", "qoderclicn");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "qoderclicn.exe"), "fake", "utf8");

  const result = resolveQoderCommand({
      ...process.env,
      USERPROFILE: fakeHome,
      PATH: ""
  });

  assert.equal(result.available, true);
  assert.match(result.command, /qoderclicn\.exe$/i);
});

test("qoder_generate_test_patch stores patch and summary without mutating source", async () => {
  const workspace = makeTempWorkspace();
  const binDir = path.join(workspace, "bin");
  installFakeQoder(binDir, "patch");

  const result = await runQoder("patch", { workspace, env: envWithFake(binDir), timeoutMs: 5000 });

  assert.equal(result.status, "passed");
  assert.ok(result.patchFile);
  assert.equal(fs.existsSync(result.patchFile), true);
  assert.match(fs.readFileSync(result.patchFile, "utf8"), /diff --git/);
  assert.deepEqual(result.changedSourceFiles, []);
});

test("qoder_unit_test records failed run and log path", async () => {
  const workspace = makeTempWorkspace();
  const binDir = path.join(workspace, "bin");
  installFakeQoder(binDir, "failure");

  const result = await runQoder("unit", { workspace, env: envWithFake(binDir), timeoutMs: 5000 });

  assert.equal(result.status, "failed");
  assert.equal(fs.existsSync(result.logFile), true);
  assert.match(result.keyErrors, /unit test failed/);
});

test("qoder success with zero fail is not misclassified as failed", async () => {
  const workspace = makeTempWorkspace();
  const binDir = path.join(workspace, "bin");
  installFakeQoder(binDir, "pass-with-zero-fail");

  const result = await runQoder("unit", { workspace, env: envWithFake(binDir), timeoutMs: 5000 });

  assert.equal(result.status, "passed");
  assert.match(result.keyOutput, /0 fail/);
});

test("qoder screenshot success with no failure is not misclassified", async () => {
  const workspace = makeTempWorkspace();
  const binDir = path.join(workspace, "bin");
  installFakeQoder(binDir, "screenshot-success-with-no-failure");

  const result = await runQoder("browser", { workspace, env: envWithFake(binDir), timeoutMs: 5000 });

  assert.equal(result.status, "passed");
  assert.match(result.keyOutput, /截图已成功获取/);
});

test("qoder output with invalid json is marked unstructured", async () => {
  const workspace = makeTempWorkspace();
  const binDir = path.join(workspace, "bin");
  installFakeQoder(binDir, "invalid-json");

  const result = await runQoder("unit", { workspace, env: envWithFake(binDir), timeoutMs: 5000 });

  assert.equal(result.status, "completed_unstructured");
  assert.match(result.parseError, /JSON/);
});

test("qoder timeout is reported and logged", async () => {
  const workspace = makeTempWorkspace();
  const binDir = path.join(workspace, "bin");
  installFakeQoder(binDir, "timeout");

  const result = await runQoder("unit", { workspace, env: envWithFake(binDir), timeoutMs: 200 });

  assert.equal(result.status, "timeout");
  assert.equal(result.timedOut, true);
  assert.equal(fs.existsSync(result.logFile), true);
});

test("background job status and result are persisted", async () => {
  const workspace = makeTempWorkspace();
  const binDir = path.join(workspace, "bin");
  installFakeQoder(binDir, "success");
  const env = envWithFake(binDir);

  const started = await runTool("qoder_unit_test", { workspace, env, background: true, timeoutMs: 5000 });
  assert.match(started.jobId, /^job-unit-/);

  let status;
  for (let i = 0; i < 30; i += 1) {
    status = getJobStatus({ workspace, jobId: started.jobId });
    if (status.status !== "running" && status.status !== "queued") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.equal(status.status, "completed");
  const result = getJobResult({ workspace, jobId: started.jobId });
  assert.equal(result.result.status, "passed");
  assert.equal(result.result.fullLog, undefined);
});

test("background job can be cancelled", async () => {
  const workspace = makeTempWorkspace();
  const binDir = path.join(workspace, "bin");
  installFakeQoder(binDir, "timeout");
  const env = envWithFake(binDir);

  const started = await runTool("qoder_unit_test", { workspace, env, background: true, timeoutMs: 10000 });
  const cancelled = await runTool("qoder_cancel", { workspace, jobId: started.jobId });

  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.status, "cancelled");
  const status = getJobStatus({ workspace, jobId: started.jobId });
  assert.equal(status.status, "cancelled");
});

test("qoder_web_screenshot asks qoder to create screenshot", async () => {
  const workspace = makeTempWorkspace();
  const binDir = path.join(workspace, "bin");
  installFakeQoder(binDir, "web-screenshot");

  const result = await runTool("qoder_web_screenshot", {
    workspace,
    env: envWithFake(binDir),
    url: "http://example.test/",
    filename: "qoder-web-shot.png",
    timeoutMs: 5000
  });

  assert.equal(result.status, "passed");
  assert.ok(result.screenshotFile.endsWith("qoder-web-shot.png"));
  assert.equal(fs.existsSync(result.screenshotFile), true);
  assert.equal(fs.readFileSync(result.screenshotFile, "utf8"), "fake qoder screenshot");
});

test("cleanup removes old managed files", async () => {
  const workspace = makeTempWorkspace();
  const root = path.join(workspace, DATA_DIR_NAME);
  const logs = path.join(root, "logs");
  fs.mkdirSync(logs, { recursive: true });
  for (let i = 0; i < 20; i += 1) {
    fs.writeFileSync(path.join(logs, `old-${i}.log`), "x".repeat(100), "utf8");
  }

  const result = await cleanupWorkspace(workspace, { keepRuns: 1, maxBytes: 1024 });

  assert.ok(result.deletedFiles.length > 0);
  assert.ok(result.remainingBytes <= 1024);
});

function encodeMcp(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function readMcpMessage(state, chunk) {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  const headerEnd = state.buffer.indexOf("\r\n\r\n");
  if (headerEnd < 0) {
    return null;
  }
  const header = state.buffer.slice(0, headerEnd).toString("utf8");
  const match = header.match(/Content-Length:\s*(\d+)/i);
  if (!match) {
    throw new Error("Missing Content-Length");
  }
  const length = Number(match[1]);
  const start = headerEnd + 4;
  const end = start + length;
  if (state.buffer.length < end) {
    return null;
  }
  const body = state.buffer.slice(start, end).toString("utf8");
  state.buffer = state.buffer.slice(end);
  return JSON.parse(body);
}

test("MCP server starts and lists qoder tools", async () => {
  const serverPath = path.resolve("plugins/qoderclicn-test/scripts/qoderclicn-test-mcp.mjs");
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.resolve("plugins/qoderclicn-test"),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  const state = { buffer: Buffer.alloc(0), messages: [] };
  child.stdout.on("data", (chunk) => {
    let message = readMcpMessage(state, chunk);
    while (message) {
      state.messages.push(message);
      message = readMcpMessage(state, Buffer.alloc(0));
    }
  });

  child.stdin.write(encodeMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
  child.stdin.write(encodeMcp({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));

  for (let i = 0; i < 20 && state.messages.length < 2; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill();

  const list = state.messages.find((message) => message.id === 2);
  assert.ok(list);
  const names = list.result.tools.map((tool) => tool.name);
  assert.ok(names.includes("qoder_check"));
  assert.ok(names.includes("qoder_generate_test_patch"));
  assert.ok(names.includes("qoder_verify_changes"));
  assert.ok(names.includes("qoder_web_screenshot"));
  assert.ok(names.includes("qoder_cleanup"));
});
