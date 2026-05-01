#!/usr/bin/env node

import { readdir, writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function detectProjectType(folderPath: string): Promise<string> {
	try {
		const packageJsonPath = path.join(folderPath, "package.json");
		const packageData = await readFile(packageJsonPath, "utf8");
		const packageJson = JSON.parse(packageData);

		const allDeps = {
			...packageJson.dependencies,
			...packageJson.devDependencies,
		};

		if (allDeps.gatsby) return "gatsby";
		if (allDeps.astro) return "astro";
		if (allDeps["@strapi/strapi"] || allDeps.strapi) return "strapi";

		return "other";
	} catch {
		return "unknown";
	}
}

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

	// Detect project types for all folders
	const foldersWithTypes = await Promise.all(
		folderNames.map(async (folderName) => {
			const folderPath = path.join(parentDir, folderName);
			const projectType = await detectProjectType(folderPath);
			return { name: folderName, type: projectType };
		}),
	);

	// Ensure output directory exists
	const outputDir = path.dirname(csvPath);
	await mkdir(outputDir, { recursive: true });

	// Create CSV content with headers
	const csvHeaders = "name,parent_dir,discovered_at,project_type\n";
	const csvRows = foldersWithTypes
		.map(
			(folder) =>
				`"${folder.name}","${parentDir}","${discoveredAt}","${folder.type}"`,
		)
		.join("\n");
	const csvContent = csvHeaders + csvRows;

	await writeFile(csvPath, csvContent, "utf8");

	const output = foldersWithTypes
		.map((folder) => `- ${folder.name} (${folder.type})`)
		.join("\n");

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
