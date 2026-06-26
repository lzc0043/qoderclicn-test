#!/usr/bin/env node

import process from "node:process";

import { runTool } from "./lib/qoder-runner.mjs";

const PROTOCOL_VERSION = "2024-11-05";

const tools = [
  {
    name: "qoder_check",
    description: "Check qoderclicn.cmd / qoderclicn.exe / qoderclicn availability.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Workspace path. Defaults to the current directory." }
      }
    }
  },
  {
    name: "qoder_generate_test_patch",
    description: "Ask Qoder to generate a test patch without editing source files.",
    inputSchema: commonRunSchema("Generate test patch")
  },
  {
    name: "qoder_unit_test",
    description: "Ask Qoder to run or validate existing unit tests.",
    inputSchema: commonRunSchema("Run unit tests")
  },
  {
    name: "qoder_browser_test",
    description: "Ask Qoder to run existing browser automation tests.",
    inputSchema: commonRunSchema("Run browser automation tests")
  },
  {
    name: "qoder_verify_changes",
    description: "Ask Qoder to verify current Codex changes.",
    inputSchema: commonRunSchema("Verify changes")
  },
  {
    name: "qoder_web_screenshot",
    description: "Ask Qoder to capture a web page screenshot and return the screenshot path.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        workspace: { type: "string" },
        url: { type: "string", description: "HTTP or HTTPS URL to ask Qoder to capture." },
        filename: { type: "string", description: "PNG filename Qoder should save under .qoderclicn-test/logs." },
        navigationInstructions: { type: "string", description: "Optional page navigation instructions before screenshot." },
        instructions: { type: "string", description: "Optional extra instructions for Qoder." },
        model: { type: "string", description: "Optional Qoder model name, for example glm5.2. Defaults to Qoder CLI configuration or QODER_MODEL." },
        permissionMode: {
          type: "string",
          enum: ["default", "accept_edits", "bypass_permissions", "dont_ask", "auto"],
          description: "Qoder permission mode. Defaults to dont_ask so test runs do not repeatedly ask for approval."
        },
        fullPage: { type: "boolean", description: "Capture the full scrollable page. Defaults to true." },
        timeoutMs: { type: "number" },
        keepRuns: { type: "number" },
        maxBytes: { type: "number" }
      }
    }
  },
  {
    name: "qoder_status",
    description: "Check a background Qoder job status.",
    inputSchema: jobSchema()
  },
  {
    name: "qoder_result",
    description: "Read a background Qoder job result. Full logs are omitted unless verbose is true.",
    inputSchema: {
      type: "object",
      required: ["jobId"],
      properties: {
        workspace: { type: "string" },
        jobId: { type: "string" },
        verbose: { type: "boolean", description: "Include full raw log." }
      }
    }
  },
  {
    name: "qoder_cancel",
    description: "Cancel a background Qoder job.",
    inputSchema: jobSchema()
  },
  {
    name: "qoder_cleanup",
    description: "Remove old logs, reports, patches, and job files.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        keepRuns: { type: "number", description: "Recent run count to keep. Defaults to 30." },
        maxBytes: { type: "number", description: "Maximum managed bytes to keep. Defaults to 500MB." }
      }
    }
  }
];

function commonRunSchema(description) {
  return {
    type: "object",
    properties: {
      workspace: { type: "string", description: "Workspace path. Defaults to the current directory." },
      instructions: { type: "string", description: `${description} instructions.` },
      testCommand: { type: "string", description: "Optional existing test command." },
      model: { type: "string", description: "Optional Qoder model name, for example glm5.2. Defaults to Qoder CLI configuration or QODER_MODEL." },
      permissionMode: {
        type: "string",
        enum: ["default", "accept_edits", "bypass_permissions", "dont_ask", "auto"],
        description: "Qoder permission mode. Defaults to dont_ask so test runs do not repeatedly ask for approval."
      },
      timeoutMs: { type: "number", description: "Timeout in milliseconds." },
      background: { type: "boolean", description: "Run in background." },
      keepRuns: { type: "number" },
      maxBytes: { type: "number" }
    }
  };
}

function jobSchema() {
  return {
    type: "object",
    required: ["jobId"],
    properties: {
      workspace: { type: "string" },
      jobId: { type: "string" }
    }
  };
}

function encodeMessage(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function send(message) {
  process.stdout.write(encodeMessage(message));
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

let buffer = Buffer.alloc(0);

function tryReadMessages() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      return;
    }
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      throw new Error("MCP message missing Content-Length header.");
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) {
      return;
    }
    const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.slice(bodyEnd);
    void handleMessage(JSON.parse(body));
  }
}

async function handleMessage(message) {
  const id = message.id;
  try {
    switch (message.method) {
      case "initialize":
        result(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "qoderclicn-test",
            version: "0.1.0"
          }
        });
        break;
      case "notifications/initialized":
        break;
      case "tools/list":
        result(id, { tools });
        break;
      case "tools/call": {
        const output = await runTool(message.params?.name, message.params?.arguments || {});
        result(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(output, null, 2)
            }
          ],
          isError: false
        });
        break;
      }
      default:
        error(id, -32601, `Unsupported method: ${message.method}`);
    }
  } catch (err) {
    error(id, -32000, err instanceof Error ? err.message : String(err));
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  tryReadMessages();
});
