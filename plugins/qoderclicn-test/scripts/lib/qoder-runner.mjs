import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DATA_DIR_NAME = ".qoderclicn-test";
export const DEFAULT_KEEP_RUNS = 30;
export const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
export const DEFAULT_TIMEOUTS = {
  patch: 10 * 60 * 1000,
  unit: 10 * 60 * 1000,
  browser: 15 * 60 * 1000,
  verify: 20 * 60 * 1000
};

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".ts",
  ".tsx",
  ".vue"
]);

/**
 * 解析并规范化工作区路径，避免 MCP 调用使用不存在的目录。
 *
 * @param {string | undefined | null} workspace
 * @returns {string}
 */
export function resolveWorkspace(workspace) {
  const resolved = path.resolve(workspace || process.cwd());
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Workspace does not exist or is not a directory: ${resolved}`);
  }
  return resolved;
}

/**
 * 创建插件运行数据目录。所有日志、报告、patch、任务状态都限制在工作区隐藏目录下。
 *
 * @param {string} workspace
 * @returns {{root: string, patches: string, reports: string, logs: string, jobs: string}}
 */
export function ensureDataDirs(workspace) {
  const root = path.join(workspace, DATA_DIR_NAME);
  const dirs = {
    root,
    patches: path.join(root, "patches"),
    reports: path.join(root, "reports"),
    logs: path.join(root, "logs"),
    jobs: path.join(root, "jobs")
  };
  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dirs;
}

export function createRunId(prefix = "run") {
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${prefix}-${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

function splitPathList(value) {
  return String(value || "")
    .split(path.delimiter)
    .filter(Boolean);
}

function candidateExecutableNames() {
  return process.platform === "win32" ? ["qoderclicn.cmd", "qoderclicn.exe", "qoderclicn"] : ["qoderclicn"];
}

function executableExists(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function resolveCommandByNames(names, env = process.env) {
  for (const dir of splitPathList(env.PATH)) {
    for (const name of names) {
      const fullPath = path.join(dir, name);
      if (executableExists(fullPath)) {
        return {
          available: true,
          command: fullPath,
          detail: `Found ${name} at ${fullPath}`
        };
      }
    }
  }
  return {
    available: false,
    command: null,
    detail: `Command was not found on PATH. Looked for: ${names.join(", ")}`
  };
}

/**
 * Windows 下优先解析 .cmd 包装器，避免 PowerShell 执行策略拦截 .ps1。
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{available: boolean, command: string | null, detail: string}}
 */
export function resolveQoderCommand(env = process.env) {
  const names = candidateExecutableNames();
  const pathResult = resolveCommandByNames(names, env);
  if (pathResult.available) {
    return pathResult;
  }
  if (process.platform === "win32") {
    const home = env.USERPROFILE || os.homedir();
    const bundledExe = path.join(home, ".qoder-cn", "bin", "qoderclicn", "qoderclicn.exe");
    if (executableExists(bundledExe)) {
      return {
        available: true,
        command: bundledExe,
        detail: `Found qoderclicn.exe at ${bundledExe}`
      };
    }
  }
  return {
    available: false,
    command: null,
    detail: `qoderclicn was not found on PATH. Looked for: ${names.join(", ")}`
  };
}

function safeJsonParse(text) {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (error) {
    return { value: null, error };
  }
}

function extractTextFromQoderJson(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  for (const key of ["result", "content", "text", "message", "summary", "output"]) {
    if (typeof value[key] === "string") {
      return value[key];
    }
  }
  if (Array.isArray(value.messages)) {
    return value.messages
      .map((entry) => extractTextFromQoderJson(entry))
      .filter(Boolean)
      .join("\n");
  }
  return JSON.stringify(value, null, 2);
}

function extractDiff(text) {
  const raw = String(text || "");
  const fenced = raw.match(/```(?:diff|patch)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const index = candidate.indexOf("diff --git ");
  if (index >= 0) {
    return candidate.slice(index).trim();
  }
  if (/^---\s+\S+/m.test(candidate) && /^\+\+\+\s+\S+/m.test(candidate)) {
    return candidate.trim();
  }
  return "";
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function truncate(value, limit = 4000) {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]`;
}

function buildBasePrompt(kind, options = {}) {
  const extra = options.instructions ? `\n用户补充要求：\n${options.instructions}\n` : "";
  const command = options.testCommand ? `\n指定测试命令：${options.testCommand}\n` : "";
  const common = [
    "你是 Qoder CN CLI，当前由 Codex 调用作为独立测试验证者。",
    "硬性规则：不要修改主工作区源码，不要调用写文件工具，不要自动应用 patch。",
    "允许执行只读 Bash 测试命令，例如版本检查、单元测试、浏览器自动化测试命令。",
    "如果需要建议测试代码，只输出 unified diff/patch，不要直接写入文件。",
    "输出应便于 Codex 消费：先给简洁中文结论，再保留关键原始错误。"
  ].join("\n");

  if (kind === "patch") {
    return `${common}

任务：根据当前工作区改动，生成补充测试的 unified diff patch。
要求：
1. 只生成测试相关文件的 patch。
2. 不要修改业务源码。
3. 如果不需要新增测试，明确说明原因。
4. 必须输出可保存为 .patch 的 diff 内容。
${extra}`;
  }

  if (kind === "unit") {
    return `${common}

任务：只读运行或指导运行当前项目已有单元测试。
要求：
1. 优先使用项目已有测试命令。
2. 报告实际执行或建议执行的命令。
3. 区分测试通过、测试失败、环境缺失、无法判断。
4. 不要修改源码。
${command}${extra}`;
  }

  if (kind === "browser") {
    return `${common}

任务：只读运行当前项目已有浏览器自动化测试，例如 Playwright 或 Cypress。
要求：
1. 只使用项目已有浏览器测试，不临时创建测试文件。
2. 报告启动命令、测试命令、失败用例、trace/screenshot 路径。
3. 不要修改源码。
${command}${extra}`;
  }

  return `${common}

任务：综合验证 Codex 的当前改动。
要求：
1. 先判断项目技术栈和已有测试入口。
2. 运行或建议运行单元测试和已有浏览器自动化测试。
3. 如果测试覆盖不足，可以建议补充测试，但不要直接写文件。
4. 输出最终结论、失败用例、关键错误、日志路径建议。
${command}${extra}`;
}

function buildQoderArgs(workspace, prompt) {
  return [
    "-p",
    "--output-format=json",
    "--permission-mode",
    "auto",
    "--disallowed-tools=WRITE",
    "-w",
    workspace,
    prompt
  ];
}

function quoteWindowsCmdArg(value) {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildSpawnCommand(command, args) {
  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/c", "call", command, ...args]
    };
  }
  return { command, args };
}

function spawnWithTimeout(command, args, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let settled = false;
    const spawnCommand = buildSpawnCommand(command, args);
    const child = spawn(spawnCommand.command, spawnCommand.args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
      shell: false
    });

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      resolve({
        exitCode: null,
        signal: "SIGTERM",
        timedOut: true,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr
      });
    }, options.timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: null,
        signal: null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`
      });
    });
    child.on("exit", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: code,
        signal,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr
      });
    });
  });
}

function listFilesRecursive(root, options = {}) {
  const result = [];
  const ignored = new Set([DATA_DIR_NAME, ".git", "node_modules", "dist", "build", "target", ".next", ".nuxt"]);
  const maxFiles = options.maxFiles ?? 5000;
  const walk = (dir) => {
    if (result.length >= maxFiles) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SOURCE_EXTENSIONS.has(ext)) {
          result.push(fullPath);
        }
      }
    }
  };
  walk(root);
  return result;
}

function snapshotSourceFiles(workspace) {
  const snapshot = new Map();
  for (const filePath of listFilesRecursive(workspace)) {
    const stat = fs.statSync(filePath);
    snapshot.set(path.relative(workspace, filePath), `${stat.size}:${stat.mtimeMs}`);
  }
  return snapshot;
}

function diffSourceSnapshot(before, workspace) {
  const after = snapshotSourceFiles(workspace);
  const changed = [];
  for (const [relPath, value] of after.entries()) {
    if (before.get(relPath) !== value) {
      changed.push(relPath);
    }
  }
  for (const relPath of before.keys()) {
    if (!after.has(relPath)) {
      changed.push(relPath);
    }
  }
  return [...new Set(changed)].sort();
}

function summarizeStatus(runResult, parsed, text) {
  if (runResult.timedOut) {
    return "timeout";
  }
  if (runResult.exitCode !== 0) {
    return "failed";
  }
  const lower = `${text}\n${runResult.stderr}`.toLowerCase();
  if (
    /全部通过|验证通过|测试通过|截图已成功获取|页面正常加载|无错误、无失败|未发现明确失败信号/.test(text) ||
    (/\b\d+\s+pass(?:ed)?\b/.test(lower) && /\b0\s+fail(?:ed)?\b/.test(lower))
  ) {
    return "passed";
  }
  if (/(fail|failed|error|exception|timeout|失败|错误)/.test(lower)) {
    return "failed";
  }
  if (parsed.error) {
    return "completed_unstructured";
  }
  return "passed";
}

/**
 * 执行一次 Qoder 调用并落盘报告。该函数只返回摘要和路径，不把完整日志塞回 Codex。
 *
 * @param {"patch" | "unit" | "browser" | "verify"} kind
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function runQoder(kind, options = {}) {
  const workspace = resolveWorkspace(options.workspace);
  const dirs = ensureDataDirs(workspace);
  const runId = options.runId || createRunId(kind);
  const availability = resolveQoderCommand(options.env || process.env);
  const logFile = path.join(dirs.logs, `${runId}-qoder.log`);
  const reportFile = path.join(dirs.reports, `${runId}-summary.json`);
  const patchFile = kind === "patch" ? path.join(dirs.patches, `${runId}-test-proposal.patch`) : null;
  const startedAt = new Date().toISOString();

  if (!availability.available) {
    const report = {
      runId,
      kind,
      status: "unavailable",
      summaryZh: "未找到 qoderclicn，请先安装并确保 qoderclicn.cmd 或 qoderclicn 在 PATH 中。",
      command: null,
      logFile,
      reportFile,
      patchFile,
      startedAt,
      completedAt: new Date().toISOString(),
      detail: availability.detail
    };
    fs.writeFileSync(logFile, `${availability.detail}\n`, "utf8");
    writeJson(reportFile, report);
    return report;
  }

  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUTS[kind];
  const prompt = buildBasePrompt(kind, options);
  const args = buildQoderArgs(workspace, prompt);
  const before = snapshotSourceFiles(workspace);
  const runResult = await spawnWithTimeout(availability.command, args, {
    cwd: workspace,
    env: options.env || process.env,
    timeoutMs
  });
  const changedSourceFiles = diffSourceSnapshot(before, workspace);
  const rawLog = [
    `command: ${availability.command} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`,
    `exitCode: ${runResult.exitCode}`,
    `timedOut: ${runResult.timedOut}`,
    "",
    "STDOUT:",
    runResult.stdout,
    "",
    "STDERR:",
    runResult.stderr
  ].join("\n");
  fs.writeFileSync(logFile, rawLog, "utf8");

  const parsed = safeJsonParse(runResult.stdout.trim());
  const outputText = parsed.error ? runResult.stdout : extractTextFromQoderJson(parsed.value);
  const diff = kind === "patch" ? extractDiff(outputText) : "";
  if (patchFile && diff) {
    fs.writeFileSync(patchFile, `${diff}\n`, "utf8");
  }

  const sourceMutationViolation = changedSourceFiles.length > 0;
  const status = sourceMutationViolation ? "policy_violation" : summarizeStatus(runResult, parsed, outputText);
  const report = {
    runId,
    kind,
    status,
    summaryZh: sourceMutationViolation
      ? "检测到 Qoder 运行期间主工作区源码发生变化，已标记为策略违规。请人工检查，插件不会自动回滚。"
      : status === "passed"
        ? "Qoder 验证完成，未发现明确失败信号。"
        : status === "timeout"
          ? "Qoder 执行超时，已终止进程并保留日志。"
          : status === "unavailable"
            ? "Qoder CLI 不可用。"
            : "Qoder 验证未通过或输出无法结构化解析，请查看关键错误和日志。",
    command: {
      executable: availability.command,
      args: ["-p", "--output-format=json", "--permission-mode", "auto", "--disallowed-tools=WRITE", "-w", workspace, "<prompt>"]
    },
    exitCode: runResult.exitCode,
    timedOut: runResult.timedOut,
    durationMs: runResult.durationMs,
    changedSourceFiles,
    patchFile: diff ? patchFile : null,
    reportFile,
    logFile,
    keyOutput: truncate(outputText),
    keyErrors: truncate(runResult.stderr, 3000),
    parseError: parsed.error ? parsed.error.message : null,
    startedAt,
    completedAt: new Date().toISOString()
  };
  writeJson(reportFile, report);
  await cleanupWorkspace(workspace, {
    keepRuns: options.keepRuns ?? DEFAULT_KEEP_RUNS,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES
  });
  return report;
}

function normalizeOutputFileName(value, fallback) {
  const raw = String(value || fallback || "qoder-screenshot.png").trim();
  const base = path.basename(raw).replace(/[^\w.-]/g, "-");
  return base.toLowerCase().endsWith(".png") ? base : `${base}.png`;
}

function extractExistingPngPath(text, workspace, expectedPath = null) {
  if (expectedPath && fs.existsSync(expectedPath)) {
    return expectedPath;
  }
  const matches = String(text || "").match(/[A-Za-z]:\\[^\r\n`"]+?\.png|\.qoderclicn-test[\\/][^\r\n`"]+?\.png/g) ?? [];
  for (const raw of matches) {
    const candidate = path.isAbsolute(raw) ? raw : path.resolve(workspace, raw);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function runQoderWebScreenshot(options = {}) {
  const workspace = resolveWorkspace(options.workspace);
  const dirs = ensureDataDirs(workspace);
  const runId = options.runId || createRunId("web-screenshot");
  const url = String(options.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("qoder_web_screenshot requires an http or https URL.");
  }
  const filename = normalizeOutputFileName(options.filename, `${runId}.png`);
  const screenshotPath = path.join(dirs.logs, filename);
  const fullPageFlag = options.fullPage === false ? "" : " --full-page";
  const navigationInstructions = options.navigationInstructions
    ? `\nAdditional navigation instructions before screenshot:\n${options.navigationInstructions}\n`
    : "";
  const instructions = [
    `Target URL: ${url}`,
    "Use Qoder to execute the browser automation. Do not let the plugin bypass Qoder.",
    "Do not modify source files.",
    "Only create the screenshot artifact under .qoderclicn-test/logs.",
    "Run these commands or their closest available equivalents:",
    "1. mkdir .qoderclicn-test\\logs if the directory is missing.",
    `2. playwright-cli.cmd open ${url}`,
    navigationInstructions.trim(),
    `3. playwright-cli.cmd screenshot --filename=${screenshotPath}${fullPageFlag}`,
    "Return the screenshot absolute path, final URL, page title, and whether the screenshot file exists.",
    options.instructions ? `User notes:\n${options.instructions}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const result = await runQoder("verify", {
    ...options,
    workspace,
    runId,
    instructions,
    timeoutMs: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUTS.browser
  });
  const screenshotFile = extractExistingPngPath(result.keyOutput, workspace, screenshotPath);
  const enriched = {
    ...result,
    kind: "web_screenshot",
    requestedUrl: url,
    screenshotFile,
    screenshotBytes: screenshotFile ? fs.statSync(screenshotFile).size : 0
  };
  if (result.reportFile) {
    writeJson(result.reportFile, enriched);
  }
  return enriched;
}

export async function checkQoder(options = {}) {
  const workspace = resolveWorkspace(options.workspace);
  ensureDataDirs(workspace);
  const availability = resolveQoderCommand(options.env || process.env);
  if (!availability.available) {
    return {
      available: false,
      command: null,
      version: null,
      detail: availability.detail
    };
  }
  const versionResult = await spawnWithTimeout(availability.command, ["--version"], {
    cwd: workspace,
    env: options.env || process.env,
    timeoutMs: 15000
  });
  return {
    available: versionResult.exitCode === 0,
    command: availability.command,
    version: versionResult.stdout.trim() || null,
    detail: versionResult.exitCode === 0 ? availability.detail : versionResult.stderr.trim() || availability.detail
  };
}

function jobPath(workspace, jobId) {
  return path.join(ensureDataDirs(workspace).jobs, `${jobId}.json`);
}

export function readJob(workspace, jobId) {
  const filePath = jobPath(workspace, jobId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Job not found: ${jobId}`);
  }
  return readJson(filePath);
}

export function writeJob(workspace, job) {
  writeJson(jobPath(workspace, job.jobId), job);
}

export function startBackgroundJob(kind, options = {}) {
  const workspace = resolveWorkspace(options.workspace);
  const dirs = ensureDataDirs(workspace);
  const jobId = createRunId(`job-${kind}`);
  const requestFile = path.join(dirs.jobs, `${jobId}.request.json`);
  const job = {
    jobId,
    kind,
    status: "queued",
    workspace,
    requestFile,
    pid: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    result: null,
    error: null
  };
  writeJson(requestFile, { kind, options: { ...options, workspace, runId: jobId } });
  writeJob(workspace, job);

  const workerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "qoder-worker.mjs");
  const child = spawn(process.execPath, [workerPath, "--workspace", workspace, "--job-id", jobId], {
    cwd: path.resolve(path.dirname(workerPath), ".."),
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  job.pid = child.pid ?? null;
  job.status = "running";
  writeJob(workspace, job);
  return {
    jobId,
    status: job.status,
    workspace,
    jobFile: jobPath(workspace, jobId),
    requestFile
  };
}

export function cancelJob(options = {}) {
  const workspace = resolveWorkspace(options.workspace);
  const job = readJob(workspace, options.jobId);
  if (job.status !== "running" && job.status !== "queued") {
    return {
      jobId: job.jobId,
      cancelled: false,
      status: job.status,
      detail: "Job is not active."
    };
  }
  if (job.pid) {
    try {
      process.kill(job.pid);
    } catch {
      // 取消是尽力而为；进程可能已经结束，状态文件仍会记录取消请求。
    }
  }
  const next = {
    ...job,
    status: "cancelled",
    completedAt: new Date().toISOString(),
    error: "Cancelled by user."
  };
  writeJob(workspace, next);
  return {
    jobId: job.jobId,
    cancelled: true,
    status: "cancelled"
  };
}

export function getJobStatus(options = {}) {
  const workspace = resolveWorkspace(options.workspace);
  const job = readJob(workspace, options.jobId);
  return {
    jobId: job.jobId,
    kind: job.kind,
    status: job.status,
    pid: job.pid,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    result: job.result
      ? {
          status: job.result.status,
          summaryZh: job.result.summaryZh,
          reportFile: job.result.reportFile,
          logFile: job.result.logFile,
          patchFile: job.result.patchFile
        }
      : null,
    error: job.error
  };
}

export function getJobResult(options = {}) {
  const workspace = resolveWorkspace(options.workspace);
  const job = readJob(workspace, options.jobId);
  if (!options.verbose && job.result) {
    return {
      ...job,
      result: {
        ...job.result,
        fullLog: undefined
      }
    };
  }
  if (options.verbose && job.result?.logFile && fs.existsSync(job.result.logFile)) {
    return {
      ...job,
      result: {
        ...job.result,
        fullLog: fs.readFileSync(job.result.logFile, "utf8")
      }
    };
  }
  return job;
}

function collectManagedFiles(dirs) {
  const files = [];
  for (const dir of [dirs.logs, dirs.reports, dirs.patches, dirs.jobs]) {
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }
      const filePath = path.join(dir, entry.name);
      const stat = fs.statSync(filePath);
      files.push({ filePath, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

/**
 * 清理旧运行文件，避免日志、报告和 patch 在项目内无限增长。
 *
 * @param {string} workspace
 * @param {{keepRuns?: number, maxBytes?: number}} options
 * @returns {Promise<{deletedFiles: string[], remainingBytes: number}>}
 */
export async function cleanupWorkspace(workspace, options = {}) {
  const dirs = ensureDataDirs(resolveWorkspace(workspace));
  const keepRuns = Math.max(1, Number(options.keepRuns || DEFAULT_KEEP_RUNS));
  const maxBytes = Math.max(1024 * 1024, Number(options.maxBytes || DEFAULT_MAX_BYTES));
  const files = collectManagedFiles(dirs);
  const deletedFiles = [];
  let remaining = files.reduce((sum, file) => sum + file.size, 0);
  const keep = new Set(files.slice(0, keepRuns * 4).map((file) => file.filePath));

  for (const file of [...files].reverse()) {
    if (keep.has(file.filePath) && remaining <= maxBytes) {
      continue;
    }
    try {
      fs.unlinkSync(file.filePath);
      deletedFiles.push(file.filePath);
      remaining -= file.size;
    } catch {
      // 清理失败不影响主流程，返回未清理完的剩余大小供调用方判断。
    }
  }
  return {
    deletedFiles,
    remainingBytes: Math.max(0, remaining)
  };
}

export async function runTool(toolName, args = {}) {
  const background = Boolean(args.background);
  const kindByTool = {
    qoder_generate_test_patch: "patch",
    qoder_unit_test: "unit",
    qoder_browser_test: "browser",
    qoder_verify_changes: "verify"
  };

  if (toolName === "qoder_check") {
    return checkQoder(args);
  }
  if (toolName === "qoder_cleanup") {
    const workspace = resolveWorkspace(args.workspace);
    return cleanupWorkspace(workspace, args);
  }
  if (toolName === "qoder_web_screenshot") {
    return runQoderWebScreenshot(args);
  }
  if (toolName === "qoder_status") {
    return getJobStatus(args);
  }
  if (toolName === "qoder_result") {
    return getJobResult(args);
  }
  if (toolName === "qoder_cancel") {
    return cancelJob(args);
  }

  const kind = kindByTool[toolName];
  if (!kind) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  if (background) {
    return startBackgroundJob(kind, args);
  }
  return runQoder(kind, args);
}

export function parseCliArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}
