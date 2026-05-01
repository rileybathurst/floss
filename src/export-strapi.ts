#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

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
				reject(new Error(`Command failed with exit code ${code}`));
			}
		});

		child.on("error", (error) => {
			reject(error);
		});
	});
}

async function parseCsv(csvContent: string): Promise<
	Array<{
		name: string;
		parentDir: string;
		discoveredAt: string;
		projectType: string;
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
		};
	});
}

async function main(): Promise<void> {
	const scriptDir = path.dirname(fileURLToPath(import.meta.url));
	const projectDir = path.resolve(scriptDir, "..");
	const csvPath = path.join(projectDir, "output/parent-projects.csv");
	console.log(`Reading CSV file from: ${csvPath}`);

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
			exportStatus: string;
			exportFile: string;
		}> = [];
		for (const project of strapiProjects) {
			const projectPath = path.join(project.parentDir, project.name);

			console.log(`\n🚀 Running strapi export in: ${project.name}`);
			console.log(`   Directory: ${projectPath}`);

			try {
				const output = await runCommand(
					"npm",
					["run", "strapi", "export", "--", "--no-encrypt", "--no-compress"],
					projectPath,
				);

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
			"name,parent_dir,discovered_at,project_type,export_status,export_file\n";
		const csvRows = updatedProjects
			.map(
				(proj) =>
					`"${proj.name}","${proj.parentDir}","${proj.discoveredAt}","${proj.projectType}","${proj.exportStatus}","${proj.exportFile}"`,
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
