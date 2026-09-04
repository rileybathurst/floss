#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

async function runNpmScript(scriptName: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn("npm", ["run", scriptName], {
			cwd: projectRoot,
			stdio: "inherit",
			shell: false,
		});

		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(
				new Error(`Command failed: npm run ${scriptName} (exit code ${code})`),
			);
		});

		child.on("error", (error) => {
			reject(error);
		});
	});
}

async function runListThenExport(): Promise<void> {
	console.log("Running list step...");
	await runNpmScript("list");
	console.log("\nRunning export step...");
	await runNpmScript("export");
}

async function main(): Promise<void> {
	const command = process.argv[2]?.toLowerCase() ?? "all";

	switch (command) {
		case "list":
			await runNpmScript("list");
			return;
		case "export":
			await runNpmScript("export");
			return;
		case "all":
		case "run":
			await runListThenExport();
			return;
		default:
			console.log("Usage: node dist/index.js [list|export|all]");
			process.exit(1);
	}
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Failed to run command: ${message}`);
	process.exit(1);
});
