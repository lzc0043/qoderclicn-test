#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readJson(filePath, errors, label) {
  if (!fs.existsSync(filePath)) {
    errors.push(`missing ${label}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${label} must be valid JSON: ${error.message}`);
    return null;
  }
}

function requireString(payload, field, errors) {
  if (typeof payload[field] !== "string" || !payload[field].trim()) {
    errors.push(`plugin.json field ${field} must be a non-empty string`);
  }
}

function rejectTodo(value, location, errors) {
  if (typeof value === "string") {
    if (value.includes("[TODO:")) {
      errors.push(`${location} contains a TODO placeholder`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => rejectTodo(item, `${location}[${index}]`, errors));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      rejectTodo(item, `${location}.${key}`, errors);
    }
  }
}

function validateManifest(pluginRoot, errors) {
  const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
  const manifest = readJson(manifestPath, errors, ".codex-plugin/plugin.json");
  if (!manifest) {
    return;
  }
  rejectTodo(manifest, "$", errors);
  for (const field of ["name", "version", "description"]) {
    requireString(manifest, field, errors);
  }
  if (typeof manifest.version === "string" && !SEMVER_RE.test(manifest.version)) {
    errors.push("plugin.json field version must be strict semver");
  }
  if (!manifest.author || typeof manifest.author !== "object" || typeof manifest.author.name !== "string") {
    errors.push("plugin.json field author.name is required");
  }
  if (manifest.skills !== "./skills/") {
    errors.push("plugin.json field skills must be ./skills/");
  }
  if (manifest.mcpServers !== "./.mcp.json") {
    errors.push("plugin.json field mcpServers must be ./.mcp.json");
  }
  const iface = manifest.interface;
  if (!iface || typeof iface !== "object") {
    errors.push("plugin.json field interface must be an object");
    return;
  }
  for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
    if (typeof iface[field] !== "string" || !iface[field].trim()) {
      errors.push(`plugin.json field interface.${field} must be a non-empty string`);
    }
  }
  if (!Array.isArray(iface.capabilities) || !iface.capabilities.every((item) => typeof item === "string" && item.trim())) {
    errors.push("plugin.json field interface.capabilities must be an array of strings");
  }
  if (!Array.isArray(iface.defaultPrompt) || iface.defaultPrompt.length === 0) {
    errors.push("plugin.json field interface.defaultPrompt must be a non-empty array");
  }
}

function validateMcp(pluginRoot, errors) {
  const mcpPath = path.join(pluginRoot, ".mcp.json");
  const payload = readJson(mcpPath, errors, ".mcp.json");
  if (!payload) {
    return;
  }
  if (!payload.mcpServers || typeof payload.mcpServers !== "object") {
    errors.push(".mcp.json field mcpServers must be an object");
    return;
  }
  const server = payload.mcpServers["qoderclicn-test"];
  if (!server || server.command !== "node" || !Array.isArray(server.args) || !server.args.includes("./scripts/qoderclicn-test-mcp.mjs")) {
    errors.push(".mcp.json must define qoderclicn-test node server");
  }
}

function validateSkill(pluginRoot, errors) {
  const skillPath = path.join(pluginRoot, "skills", "qoderclicn-test", "SKILL.md");
  if (!fs.existsSync(skillPath)) {
    errors.push("skill qoderclicn-test is missing SKILL.md");
    return;
  }
  const content = fs.readFileSync(skillPath, "utf8").replace(/\r\n/g, "\n");
  if (!content.startsWith("---\n")) {
    errors.push("skill SKILL.md must start with YAML frontmatter");
  }
  if (!/\nname:\s*qoderclicn-test\n/.test(content)) {
    errors.push("skill frontmatter must include name: qoderclicn-test");
  }
  if (!/\ndescription:\s*\S/.test(content)) {
    errors.push("skill frontmatter must include description");
  }
}

const pluginRoot = path.resolve(process.argv[2] || "plugins/qoderclicn-test");
const errors = [];
validateManifest(pluginRoot, errors);
validateMcp(pluginRoot, errors);
validateSkill(pluginRoot, errors);

if (errors.length > 0) {
  console.error("Plugin validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Plugin validation passed: ${pluginRoot}`);
