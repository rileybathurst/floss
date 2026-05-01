#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { getMostRecentCsvPath } from "./utils.js";

// Mapping of NODE_MODULE_VERSION to Node.js version
interface NodeVersionMapping {
	version: string;
	moduleVersion: string;
}

let nodeVersionMappings: NodeVersionMapping[] = [];

async function loadNodeVersionMappings(): Promise<void> {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = path.dirname(__filename);
	// Go up one level from dist/ to project root, then into src/
	const nvmCsvPath = path.join(__dirname, "..", "src", "nvm.csv");

	try {
		const csvContent = await readFile(nvmCsvPath, "utf8");
		const lines = csvContent.trim().split("\n");
		// Skip header line
		const dataLines = lines.slice(1);

		nodeVersionMappings = dataLines.map((line) => {
			const [version, moduleVersion] = line.split(",");
			return {
				version: version.trim(),
				moduleVersion: moduleVersion.trim(),
			};
		});

		console.log("📋 Loaded Node.js version mappings:");
		nodeVersionMappings.forEach((mapping) => {
			console.log(
				`   ${mapping.version} → NODE_MODULE_VERSION ${mapping.moduleVersion}`,
			);
		});
	} catch (error) {
		console.warn("⚠️  Could not load Node version mappings from nvm.csv");
		nodeVersionMappings = [];
	}
}

function extractNodeModuleVersionError(
	errorOutput: string,
): { current: string; required: string } | null {
	const match = errorOutput.match(
		/NODE_MODULE_VERSION (\d+).*requires\s+NODE_MODULE_VERSION (\d+)/i,
	);
	if (match) {
		return {
			current: match[1],
			required: match[2],
		};
	}
	return null;
}

function getNodeVersionForModuleVersion(moduleVersion: string): string | null {
	const mapping = nodeVersionMappings.find(
		(m) => m.moduleVersion === moduleVersion,
	);
	return mapping ? mapping.version : null;
}

async function runCommand(
	command: string,
	args: string[],
	cwd: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		const child = spawn(command, args, {
			cwd,
			stdio: ["inherit", "pipe", "pipe"],
			shell: true,
		});

		child.stdout?.on("data", (data) => {
			const text = data.toString();
			console.log(text);
			output += text;
		});

		child.stderr?.on("data", (data) => {
			const text = data.toString();
			console.error(text);
			output += text;
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve(output);
			} else {
				reject(
					new Error(`Command failed with exit code ${code}\nOutput: ${output}`),
				);
			}
		});

		child.on("error", (error) => {
			reject(error);
		});
	});
}

async function runStrapiExportWithVersionHandling(
	projectPath: string,
	maxRetries: number = 2,
): Promise<string> {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			console.log(`   Attempt ${attempt}/${maxRetries}...`);
			const output = await runCommand(
				"npm",
				["run", "strapi", "export", "--", "--no-encrypt", "--no-compress"],
				projectPath,
			);
			return output;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.error(`   ❌ Export attempt ${attempt} failed:`, errorMessage);

			// Check for NODE_MODULE_VERSION mismatch
			const versionError = extractNodeModuleVersionError(errorMessage);
			if (
				versionError &&
				nodeVersionMappings.length > 0 &&
				attempt < maxRetries
			) {
				console.log(`\n🔧 Detected NODE_MODULE_VERSION mismatch:`);
				console.log(`   Current: ${versionError.current}`);
				console.log(`   Required: ${versionError.required}`);

				const requiredNodeVersion = getNodeVersionForModuleVersion(
					versionError.required,
				);
				if (requiredNodeVersion) {
					console.log(`   Switching to Node.js ${requiredNodeVersion}...`);
					try {
						await runCommand("nvm", ["use", requiredNodeVersion], projectPath);
						console.log(
							`   ✅ Successfully switched to Node.js ${requiredNodeVersion}`,
						);
						console.log(`   🔄 Retrying export...`);
						continue; // Retry the export
					} catch (nvmError) {
						console.error(`   ❌ Failed to switch Node version:`, nvmError);
					}
				} else {
					console.log(
						`   ⚠️  Could not determine required Node.js version for MODULE_VERSION ${versionError.required}`,
					);
				}
			}

			// If this was the last attempt, or we couldn't handle the error, throw it
			if (attempt === maxRetries) {
				throw error;
			}
		}
	}

	// This should never be reached, but TypeScript needs it
	throw new Error("Unexpected end of retry loop");
}

async function parseCsv(csvContent: string): Promise<
	Array<{
		name: string;
		parentDir: string;
		discoveredAt: string;
		projectType: string;
		isGit: string;
	}>
> {
	const lines = csvContent.trim().split("\n");
	// const header = lines[0];
	const dataLines = lines.slice(1);

	return dataLines.map((line) => {
		// Split by comma, but handle quoted fields properly
		const fields: string[] = [];
		let currentField = "";
		let inQuotes = false;

		for (let i = 0; i < line.length; i++) {
			const char = line[i];

			if (char === '"') {
				inQuotes = !inQuotes;
			} else if (char === "," && !inQuotes) {
				fields.push(currentField.trim());
				currentField = "";
			} else {
				currentField += char;
			}
		}
		// Don't forget the last field
		fields.push(currentField.trim());

		// Remove quotes from fields that start and end with quotes
		const cleanFields = fields.map((field) =>
			field.startsWith('"') && field.endsWith('"') ? field.slice(1, -1) : field,
		);

		return {
			name: cleanFields[0] || "",
			parentDir: cleanFields[1] || "",
			discoveredAt: cleanFields[2] || "",
			projectType: cleanFields[3] || "",
			isGit: cleanFields[4] || "",
		};
	});
}

async function main(): Promise<void> {
	// Load Node version mappings first
	await loadNodeVersionMappings();

	const csvPath = await getMostRecentCsvPath("parent-projects");
	console.log(`\nReading CSV file from: ${csvPath}`);

	try {
		// Read and parse the CSV file
		const originalCsvContent = await readFile(csvPath, "utf8");
		const projects = await parseCsv(originalCsvContent);

		// Filter for strapi projects
		const strapiProjects = projects.filter(
			(project) => project.projectType === "strapi",
		);

		if (strapiProjects.length === 0) {
			console.log("No Strapi projects found in the CSV file.");
			return;
		}

		console.log(`Found ${strapiProjects.length} Strapi project(s):`);
		strapiProjects.forEach((project) => {
			console.log(`- ${project.name}`);
		});

		// Run strapi export for each strapi project
		const exportResults: Array<{
			name: string;
			parentDir: string;
			discoveredAt: string;
			projectType: string;
			isGit: string;
			exportStatus: string;
			exportFile: string;
		}> = [];
		for (const project of strapiProjects) {
			const projectPath = path.join(project.parentDir, project.name);

			console.log(`\n🚀 Running strapi export in: ${project.name}`);
			console.log(`   Directory: ${projectPath}`);

			try {
				const output = await runStrapiExportWithVersionHandling(projectPath);

				// Extract export filename from output
				const exportMatch = output.match(
					/Export archive is in ([\w\d_\.\-]+(?:\.tar)?)/i,
				);
				const exportFile = exportMatch ? exportMatch[1] : "export_completed";

				exportResults.push({
					...project,
					exportStatus: "success",
					exportFile: exportFile,
				});

				console.log(
					`✅ Successfully exported data from ${project.name}: ${exportFile}`,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				exportResults.push({
					...project,
					exportStatus: "failed",
					exportFile: "",
				});
				console.error(
					`❌ Failed to export data from ${project.name}: ${message}`,
				);
				// Continue with other projects even if one fails
			}
		}

		// Update CSV with export results
		const updatedProjects = projects.map((project) => {
			const exportResult = exportResults.find(
				(result) => result.name === project.name,
			);
			if (exportResult) {
				return {
					...project,
					exportStatus: exportResult.exportStatus,
					exportFile: exportResult.exportFile,
				};
			}
			return {
				...project,
				exportStatus: "",
				exportFile: "",
			};
		});

		// Write updated CSV
		const csvHeaders =
			"name,parent_dir,discovered_at,project_type,is_git_repo,export_status,export_file\n";
		const csvRows = updatedProjects
			.map(
				(proj) =>
					`"${proj.name}","${proj.parentDir}","${proj.discoveredAt}","${proj.projectType}","${proj.isGit}","${proj.exportStatus}","${proj.exportFile}"`,
			)
			.join("\n");
		const csvContent = csvHeaders + csvRows;
		await writeFile(csvPath, csvContent, "utf8");
		console.log(`\n📝 Updated CSV file with export results: ${csvPath}`);

		console.log("\n🎉 Export process completed!");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Failed to process CSV file: ${message}`);
		process.exit(1);
	}
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Unexpected error: ${message}`);
	process.exit(1);
});
