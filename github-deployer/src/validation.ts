/**
 * Requirement validation for GitHub Pages deployment
 */

import { isGitRepository, hasGitRemote, getRemoteUrl } from "./git";
import { getTauriCore, log } from "./utils";

/**
 * Validate that the project is a git repository
 */
export async function validateGitRepository(projectPath: string): Promise<void> {
  const isRepo = await isGitRepository(projectPath);

  if (!isRepo) {
    throw new Error(
      "This folder is not a git repository.\n\n" +
        "To publish to GitHub Pages, you need to:\n" +
        "1. Run: git init\n" +
        "2. Create a GitHub repository\n" +
        "3. Add it as remote: git remote add origin <url>"
    );
  }
}

/**
 * Validate that the site has been compiled
 */
export async function validateSiteCompiled(outputDir: string): Promise<void> {
  try {
    // Check if the output directory exists and has files
    const files = await getTauriCore().invoke<string[]>("list_directory_files", {
      path: outputDir,
    });

    if (!files || files.length === 0) {
      throw new Error("Site directory is empty. Please compile your site first.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("empty")) {
      throw error;
    }
    throw new Error("Site not found at .moss/site\n\nPlease compile your site first.");
  }
}

/**
 * Validate that a GitHub remote is configured
 */
export async function validateGitHubRemote(projectPath: string): Promise<string> {
  const hasRemote = await hasGitRemote(projectPath);

  if (!hasRemote) {
    throw new Error(
      "No git remote configured.\n\n" +
        "To publish, you need to:\n" +
        "1. Create a GitHub repository\n" +
        "2. Add it as remote: git remote add origin <url>"
    );
  }

  const remoteUrl = await getRemoteUrl(projectPath);

  if (!remoteUrl.includes("github.com")) {
    throw new Error(
      `Remote '${remoteUrl}' is not a GitHub URL.\n\n` +
        "GitHub Pages deployment only works with GitHub repositories.\n" +
        "Please add a GitHub remote or use a different deployment method."
    );
  }

  return remoteUrl;
}

/**
 * Run all validations and return the remote URL
 */
export async function validateAll(projectPath: string, outputDir: string): Promise<string> {
  await log("log", "   Validating git repository...");
  await validateGitRepository(projectPath);

  await log("log", "   Validating compiled site...");
  await validateSiteCompiled(outputDir);

  await log("log", "   Validating GitHub remote...");
  const remoteUrl = await validateGitHubRemote(projectPath);

  await log("log", "   All validations passed");
  return remoteUrl;
}
