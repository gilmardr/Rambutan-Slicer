/**
 * URL rules for the GitHub manifest route. They live outside route.ts because
 * a Next route module may only export its handlers.
 */

/** True for a github.com repository URL (github.com or www.github.com only). */
export function isGithubRepoHost(hostname: string): boolean {
  return /^(www\.)?github\.com$/i.test(hostname);
}

/**
 * The server fetches preset images to inline them, so only GitHub-hosted
 * HTTPS URLs are fetched; anything else could point the server at internal
 * hosts. Other absolute URLs are left in the manifest as they are.
 */
export function isInlinableGithubAssetUrl(assetUrl: string): boolean {
  try {
    const parsed = new URL(assetUrl);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password || parsed.port) return false;
    const host = parsed.hostname.toLowerCase();
    return isGithubRepoHost(host) || /(^|\.)githubusercontent\.com$/.test(host);
  } catch {
    return false;
  }
}
