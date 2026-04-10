#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

type PackageJson = {
  version?: unknown;
};

const execFileAsync = promisify(execFile);

async function getPackageInfo(parentDir: string, folderName: string): Promise<{ version: string | null; status: string }> {
  const packageJsonPath = path.join(parentDir, folderName, "package.json");

  try {
    const packageRaw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(packageRaw) as PackageJson;

    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return { version: parsed.version, status: "ok" };
    }

    return { version: null, status: "package.json found, version missing" };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: null, status: "no package.json" };
    }

    if (error instanceof SyntaxError) {
      return { version: null, status: "invalid package.json" };
    }

    const message = error instanceof Error ? error.message : String(error);
    return { version: null, status: `error: ${message}` };
  }
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function getGitStatus(folderPath: string): Promise<string> {
  try {
    const isRepo = await runGit(["rev-parse", "--is-inside-work-tree"], folderPath);
    if (isRepo !== "true") {
      return "not a git repo";
    }
  } catch {
    return "not a git repo";
  }

  let hasChanges = false;
  try {
    const statusOutput = await runGit(["status", "--porcelain"], folderPath);
    hasChanges = statusOutput.length > 0;
  } catch {
    hasChanges = false;
  }

  let upstreamBranch = "";
  try {
    upstreamBranch = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], folderPath);
  } catch {
    return hasChanges
      ? "git repo, no upstream configured, local changes"
      : "git repo, no upstream configured";
  }

  try {
    await runGit(["fetch", "--quiet"], folderPath);
  } catch {
    return hasChanges
      ? `git repo, upstream: ${upstreamBranch}, unable to fetch, local changes`
      : `git repo, upstream: ${upstreamBranch}, unable to fetch`;
  }

  const counts = await runGit(["rev-list", "--left-right", "--count", `HEAD...${upstreamBranch}`], folderPath);
  const [aheadRaw, behindRaw] = counts.split(/\s+/u);
  const ahead = Number.parseInt(aheadRaw ?? "0", 10);
  const behind = Number.parseInt(behindRaw ?? "0", 10);

  let syncState = "up to date";
  if (ahead > 0 && behind === 0) {
    syncState = `ahead by ${ahead}`;
  } else if (ahead === 0 && behind > 0) {
    syncState = `behind by ${behind}`;
  } else if (ahead > 0 && behind > 0) {
    syncState = `diverged (ahead ${ahead}, behind ${behind})`;
  }

  if (hasChanges) {
    return `git repo, upstream: ${upstreamBranch}, ${syncState}, local changes`;
  }

  return `git repo, upstream: ${upstreamBranch}, ${syncState}`;
}

async function getProjectStatusLine(parentDir: string, folderName: string): Promise<string> {
  const packageInfo = await getPackageInfo(parentDir, folderName);
  const versionPart = packageInfo.version ?? `(${packageInfo.status})`;
  const folderPath = path.join(parentDir, folderName);
  const gitStatus = await getGitStatus(folderPath);

  return `- ${folderName}: version ${versionPart}; ${gitStatus}`;
}

async function main(): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectDir = path.resolve(scriptDir, "..");
  const parentDir = path.resolve(projectDir, "..");

  const dbPath = path.join(projectDir, "parent-projects.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS parent_projects (
      name TEXT PRIMARY KEY,
      parent_dir TEXT NOT NULL,
      discovered_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS parent_project_statuses (
      project_name TEXT PRIMARY KEY,
      package_version TEXT,
      package_status TEXT NOT NULL,
      git_status TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      FOREIGN KEY(project_name) REFERENCES parent_projects(name)
    )
  `);

  const folderNames = db
    .prepare("SELECT name FROM parent_projects WHERE parent_dir = ? ORDER BY name")
    .all(parentDir)
    .map((row) => (row as { name: string }).name);

  const versionLines: string[] = [];
  const upsertStatus = db.prepare(`
    INSERT INTO parent_project_statuses (project_name, package_version, package_status, git_status, checked_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_name) DO UPDATE SET
      package_version = excluded.package_version,
      package_status = excluded.package_status,
      git_status = excluded.git_status,
      checked_at = excluded.checked_at
  `);

  for (const folderName of folderNames) {
    const packageInfo = await getPackageInfo(parentDir, folderName);
    const gitStatus = await getGitStatus(path.join(parentDir, folderName));
    const checkedAt = new Date().toISOString();

    upsertStatus.run(
      folderName,
      packageInfo.version,
      packageInfo.status,
      gitStatus,
      checkedAt
    );

    const versionPart = packageInfo.version ?? `(${packageInfo.status})`;
    const line = `- ${folderName}: version ${versionPart}; ${gitStatus}`;
    versionLines.push(line);
  }

  db.close();

  const output = versionLines.join("\n");

  console.log(`Checked package versions and git status from SQLite: ${dbPath}`);
  console.log(output || "(no folders listed)");
  console.log("\nSaved status rows to table: parent_project_statuses");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to check package versions: ${message}`);
  process.exit(1);
});
