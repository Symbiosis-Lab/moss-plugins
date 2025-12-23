/**
 * Requirement validation for GitHub Pages deployment
 */
import { listFiles } from "@symbiosis-lab/moss-api";
import { isGitRepository, hasGitRemote, getRemoteUrl } from "./git";
import { log } from "./utils";
/**
 * Validate that the project is a git repository
 */
export async function validateGitRepository(projectPath) {
    const isRepo = await isGitRepository(projectPath);
    if (!isRepo) {
        throw new Error("This folder is not a git repository.\n\n" +
            "To publish to GitHub Pages, you need to:\n" +
            "1. Run: git init\n" +
            "2. Create a GitHub repository\n" +
            "3. Add it as remote: git remote add origin <url>");
    }
}
/**
 * Validate that the site has been compiled
 * @param projectPath - Absolute path to the project directory
 * @param outputDir - Relative path to the output directory (e.g., ".moss/site")
 */
export async function validateSiteCompiled(projectPath, outputDir) {
    try {
        // Check if the output directory exists and has files
        // listFiles returns all project files, filter to those in outputDir
        const allFiles = await listFiles(projectPath);
        const siteFiles = allFiles.filter((f) => f.startsWith(outputDir));
        if (siteFiles.length === 0) {
            throw new Error("Site directory is empty. Please compile your site first.");
        }
    }
    catch (error) {
        if (error instanceof Error && error.message.includes("empty")) {
            throw error;
        }
        throw new Error("Site not found at .moss/site\n\nPlease compile your site first.");
    }
}
/**
 * Validate that a GitHub remote is configured
 */
export async function validateGitHubRemote(projectPath) {
    const hasRemote = await hasGitRemote(projectPath);
    if (!hasRemote) {
        throw new Error("No git remote configured.\n\n" +
            "To publish, you need to:\n" +
            "1. Create a GitHub repository\n" +
            "2. Add it as remote: git remote add origin <url>");
    }
    const remoteUrl = await getRemoteUrl(projectPath);
    if (!remoteUrl.includes("github.com")) {
        throw new Error(`Remote '${remoteUrl}' is not a GitHub URL.\n\n` +
            "GitHub Pages deployment only works with GitHub repositories.\n" +
            "Please add a GitHub remote or use a different deployment method.");
    }
    return remoteUrl;
}
/**
 * Run all validations and return the remote URL
 */
export async function validateAll(projectPath, outputDir) {
    await log("log", "   Validating git repository...");
    await validateGitRepository(projectPath);
    await log("log", "   Validating compiled site...");
    // Extract relative path from outputDir (it may be absolute or relative)
    const relativeOutputDir = outputDir.startsWith(projectPath)
        ? outputDir.slice(projectPath.length).replace(/^\//, "")
        : outputDir;
    await validateSiteCompiled(projectPath, relativeOutputDir);
    await log("log", "   Validating GitHub remote...");
    const remoteUrl = await validateGitHubRemote(projectPath);
    await log("log", "   All validations passed");
    return remoteUrl;
}
//# sourceMappingURL=validation.js.map