"use strict";

const vm = require("node:vm");
const { execFile } = require("node:child_process");

function checkJson(content) {
  try {
    JSON.parse(content);
    return [];
  } catch (err) {
    const msg = err.message;
    let line = 1;
    let col = 1;
    const match = msg.match(/at position (\d+)/);
    if (match) {
      const pos = Number(match[1]);
      const prefix = content.slice(0, pos);
      const lines = prefix.split("\n");
      line = lines.length;
      col = (lines[lines.length - 1] || "").length + 1;
    } else {
      const lineMatch = msg.match(/line (\d+) column (\d+)/);
      if (lineMatch) {
        line = Number(lineMatch[1]);
        col = Number(lineMatch[2]);
      }
    }
    return [{
      line,
      column: col,
      message: msg,
      severity: "error",
    }];
  }
}

function checkJavaScript(content, filename = "file.js") {
  try {
    new vm.Script(content, { filename, displayErrors: true });
    return [];
  } catch (err) {
    let line = 1;
    let col = 1;
    if (err.stack) {
      const match = err.stack.match(new RegExp(`${filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+)(?::(\\d+))?`));
      if (match) {
        line = Number(match[1]) || 1;
        col = Number(match[2]) || 1;
      }
    }
    return [{
      line,
      column: col,
      message: err.message || "Error de sintaxis",
      severity: "error",
    }];
  }
}

function checkPython(content) {
  return new Promise((resolve) => {
    const child = execFile("python3", ["-c", "import sys, ast; ast.parse(sys.stdin.read())"], (err, stdout, stderr) => {
      if (!err) return resolve([]);
      const match = (stderr || "").match(/line (\d+)/);
      const line = match ? Number(match[1]) : 1;
      resolve([{
        line,
        column: 1,
        message: (stderr || err.message).trim(),
        severity: "error",
      }]);
    });
    child.stdin.write(content);
    child.stdin.end();
  });
}

function checkShell(content) {
  return new Promise((resolve) => {
    const child = execFile("bash", ["-n"], (err, stdout, stderr) => {
      if (!err) return resolve([]);
      const match = (stderr || "").match(/line (\d+):/);
      const line = match ? Number(match[1]) : 1;
      resolve([{
        line,
        column: 1,
        message: (stderr || err.message).trim(),
        severity: "error",
      }]);
    });
    child.stdin.write(content);
    child.stdin.end();
  });
}

async function getDiagnostics(filepath, content, language) {
  const lang = (language || "").toLowerCase();
  const ext = (filepath.split(".").pop() || "").toLowerCase();

  if (lang === "json" || ext === "json") {
    return checkJson(content);
  }
  if (lang === "javascript" || ext === "js" || ext === "mjs" || ext === "cjs") {
    return checkJavaScript(content, filepath);
  }
  if (lang === "python" || ext === "py") {
    return await checkPython(content);
  }
  if (lang === "shell" || ext === "sh" || ext === "bash") {
    return await checkShell(content);
  }
  return [];
}

function extractSymbols(content, language) {
  const symbols = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Function match
    const fnMatch = line.match(/(?:function\s+([a-zA-Z0-9_$]+)|(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>)/);
    if (fnMatch) {
      const name = fnMatch[1] || fnMatch[2];
      symbols.push({ name, kind: "function", line: i + 1 });
      continue;
    }
    // Class match
    const classMatch = line.match(/class\s+([a-zA-Z0-9_$]+)/);
    if (classMatch) {
      symbols.push({ name: classMatch[1], kind: "class", line: i + 1 });
      continue;
    }
    // Interface / Type match
    const typeMatch = line.match(/(?:interface|type)\s+([a-zA-Z0-9_$]+)/);
    if (typeMatch) {
      symbols.push({ name: typeMatch[1], kind: "interface", line: i + 1 });
      continue;
    }
  }
  return symbols;
}

module.exports = { getDiagnostics, extractSymbols };
