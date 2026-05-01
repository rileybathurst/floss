import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";

export function getCsvPath(filename: string = "parent-projects"): string {
	const scriptDir = path.dirname(fileURLToPath(import.meta.url));
	const projectDir = path.resolve(scriptDir, "..");
	const now = new Date();
	const dateString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	return path.join(projectDir, `/output/${filename}-${dateString}.csv`);
}

export function getDiscoveredAtString(): string {
	const now = new Date();
	return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
}

export async function getMostRecentCsvPath(
	filename: string = "parent-projects",
): Promise<string> {
	const scriptDir = path.dirname(fileURLToPath(import.meta.url));
	const projectDir = path.resolve(scriptDir, "..");
	const outputDir = path.join(projectDir, "output");

	try {
		const files = await readdir(outputDir);
		const csvFiles = files
			.filter(
				(file) => file.startsWith(`${filename}-`) && file.endsWith(".csv"),
			)
			.sort()
			.reverse(); // Most recent first

		if (csvFiles.length === 0) {
			throw new Error(`No CSV files found matching pattern ${filename}-*.csv`);
		}

		return path.join(outputDir, csvFiles[0]);
	} catch (error) {
		// Fallback to today's file if directory doesn't exist or no files found
		return getCsvPath(filename);
	}
}
