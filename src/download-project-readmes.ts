#!/usr/bin/env node

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const [csvPath, remote, localOutputDirectory] = process.argv.slice(2);

if (!csvPath || !remote || !localOutputDirectory) {
	console.error(
		"Expected the CSV path, remote host, and local output directory.",
	);
	process.exit(1);
}

type Project = {
	name: string;
	parentDirectory: string;
	exportStatus: string;
	exportFile: string;
};

function parseCsvRecord(record: string): string[] {
	const fields: string[] = [];
	let field = "";
	let quoted = false;

	for (let index = 0; index < record.length; index += 1) {
		const character = record[index];

		if (character === '"' && record[index + 1] === '"' && quoted) {
			field += character;
			index += 1;
		} else if (character === '"') {
			quoted = !quoted;
		} else if (character === "," && !quoted) {
			fields.push(field);
			field = "";
		} else {
			field += character;
		}
	}

	fields.push(field);
	return fields;
}

function getProjects(csvContent: string): Project[] {
	const [header, ...records] = csvContent.trim().split(/\r?\n/);
	const columns = parseCsvRecord(header);
	const nameIndex = columns.indexOf("name");
	const parentDirectoryIndex = columns.indexOf("parent_dir");
	const exportStatusIndex = columns.indexOf("export_status");
	const exportFileIndex = columns.indexOf("export_file");

	if (
		nameIndex === -1 ||
		parentDirectoryIndex === -1 ||
		exportStatusIndex === -1 ||
		exportFileIndex === -1
	) {
		throw new Error(
			'CSV must include "name", "parent_dir", "export_status", and "export_file" columns.',
		);
	}

	return records.map((record) => {
		const fields = parseCsvRecord(record);
		return {
			name: fields[nameIndex] ?? "",
			parentDirectory: fields[parentDirectoryIndex] ?? "",
			exportStatus: fields[exportStatusIndex] ?? "",
			exportFile: fields[exportFileIndex] ?? "",
		};
	});
}

function copyFile(remotePath: string, localPath: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		let errorOutput = "";
		const scp = spawn("scp", [remotePath, localPath], {
			stdio: ["inherit", "inherit", "pipe"],
		});

		scp.stderr?.on("data", (data) => {
			const text = data.toString();
			errorOutput += text;
			process.stderr.write(text);
		});

		scp.on("error", reject);
		scp.on("close", (code) => {
			if (code === 0) {
				resolve(true);
			} else if (errorOutput.includes("No such file or directory")) {
				resolve(false);
			} else {
				reject(new Error(`scp exited with code ${code}`));
			}
		});
	});
}

const projects = getProjects(await readFile(csvPath, "utf8"));

for (const project of projects) {
	if (!/^[A-Za-z0-9._-]+$/.test(project.name)) {
		console.error(`Skipping unsafe project name: ${project.name}`);
		continue;
	}

	const localProjectDirectory = path.join(localOutputDirectory, project.name);
	const remoteProjectDirectory = path.posix.join(
		project.parentDirectory,
		project.name,
	);

	const projectFiles = [".env", "dump.json"];
	await mkdir(path.join(localProjectDirectory, ".tmp"), { recursive: true });

	for (const projectFile of projectFiles) {
		console.log(`Downloading ${projectFile} for ${project.name}`);
		const downloaded = await copyFile(
			`${remote}:${path.posix.join(remoteProjectDirectory, projectFile)}`,
			localProjectDirectory,
		);
		if (!downloaded) {
			console.log(`${projectFile} was not downloaded for ${project.name}.`);
		}
	}

	console.log(`Downloading .tmp/data.db for ${project.name}`);
	const databaseDownloaded = await copyFile(
		`${remote}:${path.posix.join(remoteProjectDirectory, ".tmp", "data.db")}`,
		path.join(localProjectDirectory, ".tmp", "data.db"),
	);
	if (!databaseDownloaded) {
		console.log(`.tmp/data.db was not downloaded for ${project.name}.`);
	}

	if (project.exportStatus === "success") {
		if (!/^[A-Za-z0-9._-]+$/.test(project.exportFile)) {
			throw new Error(`Invalid export filename for ${project.name}.`);
		}

		console.log(`Downloading ${project.exportFile} for ${project.name}`);
		const exportDownloaded = await copyFile(
			`${remote}:${path.posix.join(remoteProjectDirectory, project.exportFile)}`,
			localProjectDirectory,
		);
		if (!exportDownloaded) {
			console.log(
				`${project.exportFile} was not downloaded for ${project.name}.`,
			);
		}
	}
}
