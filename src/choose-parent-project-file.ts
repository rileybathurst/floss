#!/usr/bin/env node

import { cancel, intro, isCancel, outro, select } from "@clack/prompts";
import pc from "picocolors";
import { readFileSync, writeFileSync } from "node:fs";

const [availableFilesPath, selectedFilePath] = process.argv.slice(2);

if (!availableFilesPath || !selectedFilePath) {
	console.error("Expected paths for the available files and selection.");
	process.exit(1);
}

const files = readFileSync(availableFilesPath, "utf8")
	.split("\n")
	.map((file) => file.trim())
	.filter(Boolean);

if (files.length === 0) {
	console.error("No files are available to download.");
	process.exit(1);
}

intro(pc.bold(pc.cyan("floss export downloader")));

const filename = await select<string>({
	message: pc.dim("Choose an export to download:"),
	options: files.map((file, index) => ({
		value: file,
		label: index % 2 === 0 ? pc.cyan(file) : pc.magenta(file),
	})),
});

if (isCancel(filename)) {
	cancel(pc.yellow("Canceled."));
	process.exit(1);
}

writeFileSync(selectedFilePath, filename);
outro(pc.dim(`Selected ${filename}`));
