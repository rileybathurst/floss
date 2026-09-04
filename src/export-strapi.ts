#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
	extractNodeModuleVersionError,
	getNodeVersionForModuleVersion,
	hasNodeVersionMappings,
	loadNodeVersionMappings,
} from "./node-version-mappings.js";
import { getMostRecentCsvPath } from "./utils.js";

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
			shell: false,
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

// Sources whichever nvm.sh install is present so `nvm use` works in a single shell invocation.
const NVM_SOURCE_SNIPPET = [
	'export NVM_DIR="$HOME/.nvm"',
	'[ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"',
	'[ -s "/usr/local/opt/nvm/nvm.sh" ] && \\. "/usr/local/opt/nvm/nvm.sh"',
	'[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \\. "/opt/homebrew/opt/nvm/nvm.sh"',
].join(" && ");

// Combines `nvm use` and the strapi export into one shell command so the version switch
// actually applies to the npm process (a separate `nvm use` invocation would have no effect
// on a later, independently spawned command).
function buildExportCommand(nodeVersion: string | null): string {
	const exportCmd = "npm run strapi export -- --no-encrypt --no-compress";
	if (!nodeVersion) {
		return exportCmd;
	}
	return `${NVM_SOURCE_SNIPPET} && nvm use ${nodeVersion} && ${exportCmd}`;
}

async function runStrapiExportWithVersionHandling(
	projectPath: string,
	maxRetries: number = 2,
): Promise<string> {
	let nodeVersion: string | null = null;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			console.log(`   Attempt ${attempt}/${maxRetries}...`);
			const output = await runCommand(
				"bash",
				["-c", buildExportCommand(nodeVersion)],
				projectPath,
			);
			return output;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.error(`   ❌ Export attempt ${attempt} failed:`, errorMessage);

			// Check for NODE_MODULE_VERSION mismatch
			const versionError = extractNodeModuleVersionError(errorMessage);
			if (versionError && hasNodeVersionMappings() && attempt < maxRetries) {
				console.log(`\n🔧 Detected NODE_MODULE_VERSION mismatch:`);
				console.log(`   Current: ${versionError.current}`);
				console.log(`   Required: ${versionError.required}`);

				// Match the version the binary was actually compiled for, not the
				// active runtime's requirement, so nvm switches to a Node whose ABI
				// the existing native module already satisfies.
				const compatibleNodeVersion = getNodeVersionForModuleVersion(
					versionError.current,
				);
				if (compatibleNodeVersion) {
					console.log(
						`   Will retry using nvm to switch to Node.js ${compatibleNodeVersion}...`,
					);
					nodeVersion = compatibleNodeVersion;
					console.log(`   🔄 Retrying export...`);
					continue;
				} else {
					console.log(
						`   ⚠️  Could not determine a Node.js version matching the compiled MODULE_VERSION ${versionError.current}`,
					);
					console.log(
						`   💡 Add a "${"v?.x"},${versionError.current},<min>,<max>" row to src/nvm.csv for the Node.js version the module was compiled for, then retry.`,
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
