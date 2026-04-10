#!/usr/bin/env node

import { readdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectDir = path.resolve(scriptDir, "..");
  const parentDir = path.resolve(projectDir, "..");
  const projectName = path.basename(projectDir);

  const entries = await readdir(parentDir, { withFileTypes: true });
  const folderNames = entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => entry.name !== projectName)
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const dbPath = path.join(projectDir, "parent-projects.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS parent_projects (
      name TEXT PRIMARY KEY,
      parent_dir TEXT NOT NULL,
      discovered_at TEXT NOT NULL
    )
  `);

  db.exec("DELETE FROM parent_projects");
  const discoveredAt = new Date().toISOString();
  const insertProject = db.prepare(
    "INSERT INTO parent_projects (name, parent_dir, discovered_at) VALUES (?, ?, ?)"
  );
  for (const folderName of folderNames) {
    insertProject.run(folderName, parentDir, discoveredAt);
  }
  db.close();

  const output = folderNames.map((name) => `- ${name}`).join("\n");

  console.log(`Parent directory: ${parentDir}`);
  console.log(`Saved folders to SQLite: ${dbPath}`);

  console.log("Folders:");
  console.log(output || "(none)");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to list parent folders: ${message}`);
  process.exit(1);
});
