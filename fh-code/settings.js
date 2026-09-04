"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const SETTINGS_DIR = path.join(os.homedir(), ".fh-ia");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

const DEFAULTS = {
  "fhIa.authMode": "auto",
  "fhIa.provider": "grok",
  "fhIa.agentMode": "ask",
  "fhIa.failover.enabled": true,
  "fhIa.failover.order": "grok,claude,openai",
  "fhIa.claude.apiKey": "",
  "fhIa.claude.baseUrl": "https://api.anthropic.com",
  "fhIa.claude.model": "claude-sonnet-4-20250514",
  "fhIa.grok.apiKey": "",
  "fhIa.grok.baseUrl": "https://api.x.ai",
  "fhIa.grok.model": "grok-4",
  "fhIa.openai.apiKey": "",
  "fhIa.openai.baseUrl": "https://api.openai.com/v1",
  "fhIa.openai.model": "gpt-4o",
  "fhIa.fcc.enabled": true,
  "fhIa.fcc.apiKey": "freecc",
  "fhIa.fcc.baseUrl": "http://127.0.0.1:8082",
  "fhIa.fcc.model": "claude-sonnet-4-20250514",
  "fhIa.ui.theme": "auto",
  "fhIa.ui.fontSize": 15,
  "fhIa.ui.iconSize": 18,
  "fhIa.ui.accent": "",
  "fhIa.ui.userBubble": "",
  "fhIa.ui.assistantBubble": "",
};

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writeStore(data) {
  await fsp.mkdir(SETTINGS_DIR, { recursive: true });
  await fsp.writeFile(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getMergedSettings() {
  const store = readStore();
  return { ...DEFAULTS, ...store };
}

async function updateSettings(partial) {
  const current = readStore();
  const next = { ...current };
  for (const [key, val] of Object.entries(partial)) {
    if (val === undefined || val === null) {
      delete next[key];
    } else {
      next[key] = val;
    }
  }
  await writeStore(next);
  return getMergedSettings();
}

async function resetSettings() {
  await writeStore({});
  return { ...DEFAULTS };
}

module.exports = {
  SETTINGS_FILE,
  DEFAULTS,
  readStore,
  getMergedSettings,
  updateSettings,
  resetSettings,
};
