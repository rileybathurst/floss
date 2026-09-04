import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface NodeVersionMapping {
	version: string;
	moduleVersion: string;
	minModuleVersion: number;
	maxModuleVersion: number;
}

let nodeVersionMappings: NodeVersionMapping[] = [];

export async function loadNodeVersionMappings(): Promise<void> {
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
			const [version, moduleVersion, minModuleVersion, maxModuleVersion] =
				line.split(",");
			const moduleVersionNumber = Number.parseInt(moduleVersion.trim(), 10);
			return {
				version: version.trim(),
				moduleVersion: moduleVersion.trim(),
				// Rows without an explicit span fall back to exact matching
				minModuleVersion: minModuleVersion
					? Number.parseInt(minModuleVersion.trim(), 10)
					: moduleVersionNumber,
				maxModuleVersion: maxModuleVersion
					? Number.parseInt(maxModuleVersion.trim(), 10)
					: moduleVersionNumber,
			};
		});

		console.log("📋 Loaded Node.js version mappings:");
		nodeVersionMappings.forEach((mapping) => {
			console.log(
				`   ${mapping.version} → NODE_MODULE_VERSION ${mapping.moduleVersion} (span ${mapping.minModuleVersion}-${mapping.maxModuleVersion})`,
			);
		});
	} catch (error) {
		console.warn("⚠️  Could not load Node version mappings from nvm.csv");
		nodeVersionMappings = [];
	}
}

export function extractNodeModuleVersionError(
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

// nvm cannot resolve wildcard strings like "v22.x" against locally installed
// versions — it falls back to querying the remote listing, which has no literal
// "v22.x", and reports "N/A: version not yet installed". Major-only specs such
// as "v22" or "22" match installed versions locally, so strip the suffix.
function toNvmVersionSpec(version: string): string {
	return version.replace(/\.(x|\*)$/i, "");
}

export function getNodeVersionForModuleVersion(
	moduleVersion: string,
): string | null {
	// Prefer an exact match, then fall back to the span so that smaller
	// number mismatches still resolve to the closest Node.js version
	const moduleVersionNumber = Number.parseInt(moduleVersion, 10);
	const mapping =
		nodeVersionMappings.find((m) => m.moduleVersion === moduleVersion) ??
		nodeVersionMappings.find(
			(m) =>
				!Number.isNaN(moduleVersionNumber) &&
				moduleVersionNumber >= m.minModuleVersion &&
				moduleVersionNumber <= m.maxModuleVersion,
		);
	return mapping ? toNvmVersionSpec(mapping.version) : null;
}

export function hasNodeVersionMappings(): boolean {
	return nodeVersionMappings.length > 0;
}
