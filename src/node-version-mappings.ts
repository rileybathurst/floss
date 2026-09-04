import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface NodeVersionMapping {
	version: string;
	moduleVersion: string;
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

export function getNodeVersionForModuleVersion(
	moduleVersion: string,
): string | null {
	const mapping = nodeVersionMappings.find(
		(m) => m.moduleVersion === moduleVersion,
	);
	return mapping ? mapping.version : null;
}

export function hasNodeVersionMappings(): boolean {
	return nodeVersionMappings.length > 0;
}
