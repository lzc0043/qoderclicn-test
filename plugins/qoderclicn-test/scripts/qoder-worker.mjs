#!/usr/bin/env node

import fs from "node:fs";

import { parseCliArgs, readJob, runQoder, writeJob } from "./lib/qoder-runner.mjs";

const cli = parseCliArgs(process.argv.slice(2));
const workspace = cli.workspace;
const jobId = cli["job-id"];

async function main() {
  if (!workspace || !jobId) {
    throw new Error("Missing --workspace or --job-id.");
  }
  const job = readJob(workspace, jobId);
  const request = JSON.parse(fs.readFileSync(job.requestFile, "utf8"));
  writeJob(workspace, {
    ...job,
    status: "running",
    pid: process.pid
  });
  try {
    const result = await runQoder(request.kind, request.options);
    writeJob(workspace, {
      ...job,
      status: result.status === "passed" || result.status === "completed_unstructured" ? "completed" : "failed",
      pid: null,
      completedAt: new Date().toISOString(),
      result,
      error: null
    });
  } catch (error) {
    writeJob(workspace, {
      ...job,
      status: "failed",
      pid: null,
      completedAt: new Date().toISOString(),
      result: null,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
