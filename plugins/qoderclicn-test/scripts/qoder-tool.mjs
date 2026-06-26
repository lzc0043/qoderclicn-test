#!/usr/bin/env node

import process from "node:process";

import { parseCliArgs, runTool } from "./lib/qoder-runner.mjs";

function parseValue(value) {
  if (value === true || value === false) {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function parseArgs(argv) {
  const [toolName, ...rest] = argv;
  const cli = parseCliArgs(rest);
  const argsJson = cli["args-json"];
  delete cli["args-json"];

  // 统一把 PowerShell 传入的字符串参数转换成工具层需要的布尔值、数字或 JSON 参数。
  const args = Object.fromEntries(Object.entries(cli).map(([key, value]) => [key, parseValue(value)]));
  if (argsJson) {
    return {
      toolName,
      args: {
        ...args,
        ...JSON.parse(String(argsJson))
      }
    };
  }
  return { toolName, args };
}

async function main() {
  const { toolName, args } = parseArgs(process.argv.slice(2));
  if (!toolName) {
    throw new Error("Usage: node scripts/qoder-tool.mjs <qoder_tool_name> [--workspace <path>] [--args-json <json>]");
  }
  // 复用 MCP 工具的同一套实现，确保脚本降级路径和插件工具返回一致的结构化 JSON。
  const result = await runTool(toolName, args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  process.exitCode = 1;
});
