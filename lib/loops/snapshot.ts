import fs from "fs";
import os from "os";
import path from "path";
import { git } from "../git-exec";

// A commit of the worktree as it is, uncommitted work included, made with a
// throwaway index so the real index, the stash and the branch don't move.
// A clean worktree is HEAD itself. Untracked files that .gitignore hides stay
// out, as they do for any commit.
export async function snapshotWorktree(dir: string): Promise<string> {
  const head = (await git(dir, ["rev-parse", "HEAD"])).trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aos-loop-idx-"));
  const env = { GIT_INDEX_FILE: path.join(tmp, "index") };
  try {
    await git(dir, ["read-tree", "HEAD"], { env });
    await git(dir, ["add", "-A"], { env });
    const tree = (await git(dir, ["write-tree"], { env })).trim();
    const headTree = (await git(dir, ["rev-parse", "HEAD^{tree}"])).trim();
    if (tree === headTree) return head;
    return (
      await git(
        dir,
        ["commit-tree", tree, "-p", head, "-m", "AgentOS loop snapshot"],
        {
          env: {
            ...env,
            GIT_AUTHOR_NAME: "AgentOS",
            GIT_AUTHOR_EMAIL: "agentos@localhost",
            GIT_COMMITTER_NAME: "AgentOS",
            GIT_COMMITTER_EMAIL: "agentos@localhost",
          },
        }
      )
    ).trim();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
