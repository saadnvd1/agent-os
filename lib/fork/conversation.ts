/**
 * A copy of a Claude conversation for a child: the SDK's forkSession, cut
 * where lib/fork/point says, so the child knows what the parent knew and
 * its prompt cache lines up. Claude finds a conversation only under the
 * folder it starts in, so a child in another folder gets the copy moved.
 */

import fs from "fs";
import os from "os";
import {
  forkSession,
  getSessionMessages,
} from "@anthropic-ai/claude-agent-sdk";
import {
  readTranscript,
  rewritePaths,
  transcriptPath,
  writeTranscript,
} from "../tasks/transcript";
import { cutPoint } from "./point";

export interface ForkedConversation {
  // The new conversation's id: the child resumes it.
  claudeSessionId: string;
  // The entry of the parent's it was cut at.
  cut: string;
}

export class ForkError extends Error {
  override readonly name = "ForkError";
}

export async function forkConversation(opts: {
  claudeSessionId: string;
  parentCwd: string;
  childCwd: string;
  title?: string;
}): Promise<ForkedConversation> {
  const { claudeSessionId, parentCwd, childCwd } = opts;
  let cut: string | null;
  try {
    const entries = await getSessionMessages(claudeSessionId, {
      dir: parentCwd,
    });
    cut = cutPoint(entries);
  } catch (error) {
    throw new ForkError(`can't read the conversation: ${String(error)}`);
  }
  if (!cut) throw new ForkError("nothing to fork yet");
  let forked: string;
  try {
    forked = (
      await forkSession(claudeSessionId, {
        dir: parentCwd,
        upToMessageId: cut,
        title: opts.title,
      })
    ).sessionId;
  } catch (error) {
    throw new ForkError(`the fork failed: ${String(error)}`);
  }
  if (childCwd !== parentCwd) {
    const text = await readTranscript(parentCwd, forked);
    if (!text) throw new ForkError("the fork wasn't written");
    const home = os.homedir();
    await writeTranscript(
      childCwd,
      forked,
      rewritePaths(text, { cwd: parentCwd, home }, { cwd: childCwd, home })
    );
    // The parent's folder keeps its own conversations only.
    await fs.promises.rm(transcriptPath(parentCwd, forked), { force: true });
  }
  return { claudeSessionId: forked, cut };
}
