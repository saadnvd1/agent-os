// The Git toggle shows for a local session unless its folder is known not to
// be a repository. Unknown (still checking) keeps it, so it doesn't flicker
// away in real repos.
export function showGitToggle(
  isLocalSession: boolean,
  isGitRepo: boolean | undefined
): boolean {
  return isLocalSession && isGitRepo !== false;
}
