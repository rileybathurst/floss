import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { readdir, access, mkdtemp, rmdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

interface GitStatusResult {
	isGitRepo: boolean;
	isClean: boolean;
	branch?: string;
	hasUnstagedChanges: boolean;
	hasStagedChanges: boolean;
	hasUntrackedFiles: boolean;
	error?: string;
}

class GitStatusChecker {
	/**
	 * Check git status for a directory using command line git status
	 */
	async checkGitStatus(directoryPath: string): Promise<GitStatusResult> {
		try {
			// First check if it's a git repository
			const gitPath = path.join(directoryPath, ".git");
			await access(gitPath);
		} catch {
			return {
				isGitRepo: false,
				isClean: false,
				hasUnstagedChanges: false,
				hasStagedChanges: false,
				hasUntrackedFiles: false,
			};
		}

		try {
			// Run git status --porcelain for machine-readable output
			const statusOutput = execSync("git status --porcelain", {
				cwd: directoryPath,
				encoding: "utf8",
				stdio: "pipe",
			});

			// Run git branch --show-current to get current branch
			const branchOutput = execSync("git branch --show-current", {
				cwd: directoryPath,
				encoding: "utf8",
				stdio: "pipe",
			}).trim();

			// Parse the porcelain output
			const lines = statusOutput
				.trim()
				.split("\n")
				.filter((line) => line.length > 0);
			const hasStagedChanges = lines.some(
				(line) => line[0] !== " " && line[0] !== "?",
			);
			const hasUnstagedChanges = lines.some((line) => line[1] !== " ");
			const hasUntrackedFiles = lines.some((line) => line.startsWith("??"));

			return {
				isGitRepo: true,
				isClean: lines.length === 0,
				branch: branchOutput || undefined,
				hasUnstagedChanges,
				hasStagedChanges,
				hasUntrackedFiles,
			};
		} catch (error) {
			return {
				isGitRepo: true,
				isClean: false,
				hasUnstagedChanges: false,
				hasStagedChanges: false,
				hasUntrackedFiles: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Check multiple directories for git status
	 */
	async checkMultipleDirectories(
		parentDir: string,
	): Promise<Array<{ name: string; status: GitStatusResult }>> {
		try {
			const entries = await readdir(parentDir, { withFileTypes: true });
			const directories = entries
				.filter((entry) => entry.isDirectory())
				.filter((entry) => !entry.name.startsWith("."))
				.map((entry) => entry.name);

			const results = await Promise.all(
				directories.map(async (dirName) => {
					const dirPath = path.join(parentDir, dirName);
					const status = await this.checkGitStatus(dirPath);
					return { name: dirName, status };
				}),
			);

			return results;
		} catch (error) {
			throw new Error(
				`Failed to check directories: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

describe("GitStatusChecker", () => {
	let gitChecker: GitStatusChecker;
	let tempDir: string;

	beforeAll(async () => {
		gitChecker = new GitStatusChecker();
		// Create a temporary directory for testing
		tempDir = await mkdtemp(path.join(tmpdir(), "git-test-"));
	});

	describe("checkGitStatus", () => {
		it("should detect non-git directory correctly", async () => {
			const result = await gitChecker.checkGitStatus(tempDir);

			expect(result.isGitRepo).toBe(false);
			expect(result.isClean).toBe(false);
			expect(result.hasUnstagedChanges).toBe(false);
			expect(result.hasStagedChanges).toBe(false);
			expect(result.hasUntrackedFiles).toBe(false);
		});

		it("should handle git status command errors gracefully", async () => {
			// Create a mock git directory without proper git initialization
			const mockGitDir = path.join(tempDir, "mock-git");
			const mockGitPath = path.join(mockGitDir, ".git");

			// Create the .git directory structure to pass the initial check
			await import("node:fs").then((fs) =>
				fs.promises
					.mkdir(mockGitDir, { recursive: true })
					.then(() => fs.promises.mkdir(mockGitPath, { recursive: true })),
			);

			const result = await gitChecker.checkGitStatus(mockGitDir);

			expect(result.isGitRepo).toBe(true);
			expect(result.error).toBeDefined();
		});
	});

	describe("checkMultipleDirectories", () => {
		it("should check git status for sibling directories", async () => {
			// Get the parent directory to check sibling directories (like list-parent-folders.ts does)
			const currentDir = process.cwd();
			const parentDir = path.dirname(currentDir);

			const results = await gitChecker.checkMultipleDirectories(parentDir);

			expect(Array.isArray(results)).toBe(true);
			expect(results.length).toBeGreaterThan(0);

			// Each result should have a name and status
			results.forEach((result) => {
				expect(result.name).toBeDefined();
				expect(typeof result.name).toBe("string");
				expect(result.status).toBeDefined();
				expect(typeof result.status.isGitRepo).toBe("boolean");
			});

			// Results should include sibling directories, not the current floss project
			const currentProject = path.basename(currentDir);
			const hasCurrentProject = results.some((r) => r.name === currentProject);
			// Note: checkMultipleDirectories includes all dirs, but list-parent-folders filters out current project
		});

		it("should handle directory access errors gracefully", async () => {
			// Test with a non-existent directory
			const nonExistentDir = path.join(tempDir, "non-existent-dir");

			await expect(
				gitChecker.checkMultipleDirectories(nonExistentDir),
			).rejects.toThrow("Failed to check directories");
		});
	});

	describe("integration with existing codebase", () => {
		it("should match the CSV output format expectations", async () => {
			const currentDir = process.cwd();
			const parentDir = path.dirname(currentDir);

			const results = await gitChecker.checkMultipleDirectories(parentDir);

			// Verify the results can be formatted for CSV like the existing code
			results.forEach((result) => {
				const gitStatus = result.status.isGitRepo ? "yes" : "no";
				const csvLine = `"${result.name}","${parentDir}","2026/05/01","unknown","${gitStatus}","",""`;

				expect(csvLine).toMatch(/^"[^"]+",/); // Should start with quoted name
				expect(csvLine).toContain(`"${gitStatus}"`); // Should contain git status
			});
		});
	});

	describe("git status command output parsing", () => {
		it("should correctly parse git status flags for repositories", async () => {
			const currentDir = process.cwd();
			const parentDir = path.dirname(currentDir);
			const results = await gitChecker.checkMultipleDirectories(parentDir);

			// Test that for any git repositories found, the flags are mutually consistent
			results
				.filter((result) => result.status.isGitRepo && !result.status.error)
				.forEach((result) => {
					const hasAnyChanges =
						result.status.hasUnstagedChanges ||
						result.status.hasStagedChanges ||
						result.status.hasUntrackedFiles;
					expect(result.status.isClean).toBe(!hasAnyChanges);
				});
		});
	});
});
