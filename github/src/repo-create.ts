/**
 * Repository Creation Flow
 *
 * Orchestrates the complete flow for creating a new GitHub repository:
 * 1. Get auth token from credential store
 * 2. Get username from GitHub API
 * 3. Show dialog for user to enter repo name
 * 4. Create the repository
 * 5. Add as git remote
 */

import { showPluginDialog, type DialogResult } from "@symbiosis-lab/moss-api";
import { log } from "./utils";
import { getToken } from "./token";
import { getAuthenticatedUser, createRepository, addGitRemote } from "./github-api";
import { createRepoDialogUrl } from "./repo-dialog";

/**
 * Result of the repository creation flow
 */
export interface RepoCreationResult {
  /** Repository name */
  name: string;
  /** HTTPS URL for the repo */
  url: string;
  /** SSH URL for git remote */
  sshUrl: string;
  /** Full name (owner/repo) */
  fullName: string;
}

/**
 * Prompt the user to create a new repository and set it as the git remote
 *
 * This function:
 * 1. Checks for existing authentication
 * 2. Gets the authenticated user's info
 * 3. Shows a dialog for entering the repository name
 * 4. Creates the repository via GitHub API
 * 5. Adds the repository as git remote "origin"
 *
 * @returns Created repository info, or null if cancelled/failed
 */
export async function promptAndCreateRepo(): Promise<RepoCreationResult | null> {
  await log("log", "Starting repository creation flow...");

  // Step 1: Get token from credential store
  const token = await getToken();
  if (!token) {
    await log("warn", "No authentication token found");
    return null;
  }

  // Step 2: Get authenticated user info
  let username: string;
  try {
    const user = await getAuthenticatedUser(token);
    username = user.login;
    await log("log", `   Authenticated as ${username}`);
  } catch (error) {
    await log("error", `   Failed to get user info: ${error}`);
    return null;
  }

  // Step 3: Show dialog for repo name
  await log("log", "   Showing repository creation dialog...");

  const dialogUrl = createRepoDialogUrl(username, token);

  let dialogResult: DialogResult;
  try {
    dialogResult = await showPluginDialog({
      url: dialogUrl,
      title: "Create GitHub Repository",
      width: 420,
      height: 340,
      timeoutMs: 300000, // 5 minutes
    });
  } catch (error) {
    await log("error", `   Dialog error: ${error}`);
    return null;
  }

  // Check if user cancelled
  if (dialogResult.type === "cancelled") {
    await log("log", "   User cancelled repository creation");
    return null;
  }

  // Get the repository name from dialog result
  const value = dialogResult.value as { name: string } | undefined;
  if (!value?.name) {
    await log("error", "   Invalid dialog result: missing repo name");
    return null;
  }

  const repoName = value.name;
  await log("log", `   Creating repository: ${repoName}`);

  // Step 4: Create the repository
  let createdRepo;
  try {
    createdRepo = await createRepository(repoName, token, "Created with Moss");
    await log("log", `   Repository created: ${createdRepo.htmlUrl}`);
  } catch (error) {
    await log("error", `   Failed to create repository: ${error}`);
    return null;
  }

  // Step 5: Add as git remote
  try {
    await addGitRemote("origin", createdRepo.sshUrl);
    await log("log", `   Added remote: ${createdRepo.sshUrl}`);
  } catch (error) {
    // The remote might already exist or there might be other issues
    // Log but don't fail - the repo was created successfully
    await log("warn", `   Could not add remote automatically: ${error}`);
    await log("log", `   You may need to run: git remote add origin ${createdRepo.sshUrl}`);
  }

  return {
    name: createdRepo.name,
    url: createdRepo.htmlUrl,
    sshUrl: createdRepo.sshUrl,
    fullName: createdRepo.fullName,
  };
}
