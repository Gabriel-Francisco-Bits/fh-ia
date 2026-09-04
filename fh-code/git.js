"use strict";

const { execFile } = require("node:child_process");
const { safeResolve } = require("./paths");

function runGit(workspaceRoot, args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ code: err.code || 1, stdout: stdout || "", stderr: stderr || err.message });
      } else {
        resolve({ code: 0, stdout: stdout || "", stderr: stderr || "" });
      }
    });
  });
}

async function getGitStatus(workspaceRoot) {
  const branchRes = await runGit(workspaceRoot, ["branch", "--show-current"]);
  const branch = branchRes.stdout.trim() || "HEAD";

  const statusRes = await runGit(workspaceRoot, ["status", "--porcelain=v1"]);
  if (statusRes.code !== 0 && statusRes.stderr.includes("not a git repository")) {
    return { isRepo: false, branch: "", staged: [], unstaged: [], untracked: [] };
  }

  const staged = [];
  const unstaged = [];
  const untracked = [];

  const lines = statusRes.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const x = line[0];
    const y = line[1];
    const file = line.slice(3).trim();

    if (x === "?" && y === "?") {
      untracked.push({ file, status: "U" });
      continue;
    }
    if (x && x !== " " && x !== "?") {
      staged.push({ file, status: x });
    }
    if (y && y !== " " && y !== "?") {
      unstaged.push({ file, status: y });
    }
  }

  return { isRepo: true, branch, staged, unstaged, untracked };
}

async function getGitDiff(workspaceRoot, file, staged = false) {
  const target = safeResolve(workspaceRoot, file);
  const args = staged ? ["diff", "--cached", "--", file] : ["diff", "--", file];
  const res = await runGit(workspaceRoot, args);
  return res.stdout;
}

async function stageFile(workspaceRoot, file) {
  safeResolve(workspaceRoot, file);
  const res = await runGit(workspaceRoot, ["add", "--", file]);
  return res.code === 0;
}

async function unstageFile(workspaceRoot, file) {
  safeResolve(workspaceRoot, file);
  let res = await runGit(workspaceRoot, ["restore", "--staged", "--", file]);
  if (res.code !== 0) {
    res = await runGit(workspaceRoot, ["reset", "HEAD", "--", file]);
  }
  return res.code === 0;
}

async function stageAll(workspaceRoot) {
  const res = await runGit(workspaceRoot, ["add", "-A"]);
  return res.code === 0;
}

async function commit(workspaceRoot, message) {
  const msg = String(message || "").trim();
  if (!msg) throw new Error("Mensaje de commit requerido");
  const res = await runGit(workspaceRoot, ["commit", "-m", msg]);
  if (res.code !== 0) {
    throw new Error(res.stderr || "Error al realizar commit");
  }
  return res.stdout.trim();
}

async function discardChanges(workspaceRoot, file) {
  safeResolve(workspaceRoot, file);
  let res = await runGit(workspaceRoot, ["restore", "--", file]);
  if (res.code !== 0) {
    res = await runGit(workspaceRoot, ["checkout", "--", file]);
  }
  return res.code === 0;
}

module.exports = {
  runGit,
  getGitStatus,
  getGitDiff,
  stageFile,
  unstageFile,
  stageAll,
  commit,
  discardChanges,
};
