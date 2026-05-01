#!/usr/bin/env node

import { readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
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

	const csvPath = path.join(projectDir, "/output/parent-projects.csv");
	const now = new Date();
	const discoveredAt = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;

	// Ensure output directory exists
	const outputDir = path.dirname(csvPath);
	await mkdir(outputDir, { recursive: true });

	// Create CSV content with headers
	const csvHeaders = "name,parent_dir,discovered_at\n";
	const csvRows = folderNames
		.map((folderName) => `"${folderName}","${parentDir}","${discoveredAt}"`)
		.join("\n");
	const csvContent = csvHeaders + csvRows;

	await writeFile(csvPath, csvContent, "utf8");

	const output = folderNames.map((name) => `- ${name}`).join("\n");

	console.log(`Parent directory: ${parentDir}`);
	console.log(`Saved folders to CSV: ${csvPath}`);

	console.log("Folders:");
	console.log(output || "(none)");
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Failed to list parent folders: ${message}`);
	process.exit(1);
});
