import os from "os";

/**
 * A shell command line read into the simple commands it runs, for the
 * orchestrator's deny list (shell-guard.ts). It reads what a zsh or bash
 * would: quotes, escapes, `;` `&&` `||` `|` `&` and newlines between
 * commands, subshells and groups, `$( )`, backticks and `<( )` (whose
 * commands are read too), redirects and heredocs. It is a reader for honest
 * mistakes, not a sandbox: a script or an interpreter's inline code runs
 * what it likes, and nothing here sees that.
 */

export interface SimpleCommand {
  words: string[];
  // Files it writes through >, >>, &> and the like.
  writes: string[];
  // Files it reads through <.
  reads: string[];
  // What a heredoc or here-string feeds it.
  stdin: string;
}

// Stands in for text only the running shell knows: a substitution's
// output or a variable other than HOME.
export const UNKNOWN = "\u0000";

const MAX_DEPTH = 8;

const blank = (): SimpleCommand => ({
  words: [],
  writes: [],
  reads: [],
  stdin: "",
});

// The index of the `)` closing the `(` at `open`, skipping quoted text.
function closingParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") i++;
    else if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) return -1;
      i = end;
    } else if (c === '"') {
      for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === "\\") i++;
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

function closingBacktick(src: string, open: number): number {
  for (let i = open + 1; i < src.length; i++) {
    if (src[i] === "\\") i++;
    else if (src[i] === "`") return i;
  }
  return -1;
}

const ANSI: Record<string, string> = { n: "\n", t: "\t", r: "\r", e: "\x1b" };

// `$NAME` or `${NAME}` at `at` (just past the $): HOME expands, anything
// else is unknown. Returns the text and the last index read.
function variable(src: string, at: number): [string, number] {
  if (src[at] === "{") {
    const end = src.indexOf("}", at);
    if (end < 0) return [UNKNOWN, src.length - 1];
    return [src.slice(at + 1, end) === "HOME" ? os.homedir() : UNKNOWN, end];
  }
  const m = /^([A-Za-z_][A-Za-z0-9_]*|[0-9?#@*$!-])/.exec(src.slice(at));
  if (!m) return ["$", at - 1];
  return [m[1] === "HOME" ? os.homedir() : UNKNOWN, at + m[1].length - 1];
}

// The simple commands in a command line, or why it can't be read.
export function parseShell(src: string, depth = 0): SimpleCommand[] | string {
  if (depth > MAX_DEPTH) return "commands nested too deeply to check";
  const out: SimpleCommand[] = [];
  let cmd = blank();
  let word: string | null = null;
  let pending: "write" | "read" | "here" | "heredoc" | null = null;
  const heredocs: { delim: string; tabs: boolean; cmd: SimpleCommand }[] = [];
  let tabs = false;

  const endWord = () => {
    if (word === null) return;
    if (pending === "write") cmd.writes.push(word);
    else if (pending === "read") cmd.reads.push(word);
    else if (pending === "here") cmd.stdin += `${word}\n`;
    else if (pending === "heredoc") heredocs.push({ delim: word, tabs, cmd });
    else cmd.words.push(word);
    pending = null;
    word = null;
  };
  const endCmd = () => {
    endWord();
    if (cmd.words.length || cmd.writes.length || cmd.reads.length)
      out.push(cmd);
    cmd = blank();
  };
  const nest = (inner: string): string | null => {
    const r = parseShell(inner, depth + 1);
    if (typeof r === "string") return r;
    out.push(...r);
    return null;
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === " " || c === "\t") {
      endWord();
      continue;
    }
    if (c === "\n" || c === "\r") {
      endCmd();
      // Heredoc bodies start on the next line.
      for (const h of heredocs.splice(0)) {
        while (i + 1 < src.length) {
          const end = src.indexOf("\n", i + 1);
          const line = src.slice(i + 1, end < 0 ? src.length : end);
          i = end < 0 ? src.length : end;
          const text = h.tabs ? line.replace(/^\t+/, "") : line;
          if (text === h.delim) break;
          h.cmd.stdin += `${text}\n`;
        }
      }
      continue;
    }
    if (c === "#" && word === null) {
      const end = src.indexOf("\n", i);
      i = (end < 0 ? src.length : end) - 1;
      continue;
    }
    if (c === "\\") {
      if (src[i + 1] !== "\n") word = (word ?? "") + (src[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) return "an unclosed ' quote";
      word = (word ?? "") + src.slice(i + 1, end);
      i = end;
      continue;
    }
    if (c === '"') {
      let text = "";
      let j = i + 1;
      for (; j < src.length && src[j] !== '"'; j++) {
        const d = src[j];
        if (d === "\\" && j + 1 < src.length) {
          const n = src[++j];
          if (n !== "\n") text += /["\\$`]/.test(n) ? n : `\\${n}`;
        } else if (d === "$" && src[j + 1] === "(") {
          const end = closingParen(src, j + 1);
          if (end < 0) return "an unclosed $(";
          const err = nest(src.slice(j + 2, end));
          if (err) return err;
          text += UNKNOWN;
          j = end;
        } else if (d === "`") {
          const end = closingBacktick(src, j);
          if (end < 0) return "an unclosed backtick";
          const err = nest(src.slice(j + 1, end));
          if (err) return err;
          text += UNKNOWN;
          j = end;
        } else if (d === "$") {
          const [v, end] = variable(src, j + 1);
          text += v;
          j = end;
        } else text += d;
      }
      if (j >= src.length) return 'an unclosed " quote';
      word = (word ?? "") + text;
      i = j;
      continue;
    }
    if (c === "$" && src[i + 1] === "(") {
      const end = closingParen(src, i + 1);
      if (end < 0) return "an unclosed $(";
      // $(( )) is arithmetic, not a command.
      if (src[i + 2] !== "(") {
        const err = nest(src.slice(i + 2, end));
        if (err) return err;
      }
      word = (word ?? "") + UNKNOWN;
      i = end;
      continue;
    }
    if (c === "$" && src[i + 1] === "'") {
      let text = "";
      let j = i + 2;
      for (; j < src.length && src[j] !== "'"; j++) {
        if (src[j] === "\\" && j + 1 < src.length) {
          const n = src[++j];
          text += ANSI[n] ?? n;
        } else text += src[j];
      }
      if (j >= src.length) return "an unclosed $' quote";
      word = (word ?? "") + text;
      i = j;
      continue;
    }
    if (c === "$") {
      const [v, end] = variable(src, i + 1);
      word = (word ?? "") + v;
      i = end;
      continue;
    }
    if (c === "`") {
      const end = closingBacktick(src, i);
      if (end < 0) return "an unclosed backtick";
      const err = nest(src.slice(i + 1, end));
      if (err) return err;
      word = (word ?? "") + UNKNOWN;
      i = end;
      continue;
    }
    if ((c === "<" || c === ">") && src[i + 1] === "(") {
      const end = closingParen(src, i + 1);
      if (end < 0) return "an unclosed process substitution";
      const err = nest(src.slice(i + 2, end));
      if (err) return err;
      word = (word ?? "") + UNKNOWN;
      i = end;
      continue;
    }
    if (c === ">" || c === "<" || (c === "&" && src[i + 1] === ">")) {
      // A file descriptor's number (2>) belongs to the redirect.
      if (word !== null && /^\d+$/.test(word)) word = null;
      else endWord();
      if (c === "&") {
        i++;
        if (src[i + 1] === ">") i++;
        pending = "write";
      } else if (c === ">") {
        if (src[i + 1] === ">" || src[i + 1] === "|") i++;
        if (src[i + 1] === "&") {
          i++;
          // >&2 and >&- duplicate a descriptor; >&file writes the file.
          if (/[\d-]/.test(src[i + 1] ?? "")) {
            i++;
            continue;
          }
        }
        pending = "write";
      } else if (src[i + 1] === "<") {
        i++;
        if (src[i + 1] === "<") {
          i++;
          pending = "here";
        } else {
          tabs = src[i + 1] === "-";
          if (tabs) i++;
          pending = "heredoc";
        }
      } else if (src[i + 1] === "&") {
        i += 2;
      } else if (src[i + 1] === ">") {
        i++;
        pending = "write";
      } else pending = "read";
      continue;
    }
    if (/[;&|()]/.test(c)) {
      endCmd();
      continue;
    }
    if (
      (c === "{" || c === "}") &&
      word === null &&
      /^[\s;]?$/.test(src[i + 1] ?? "")
    ) {
      endCmd();
      continue;
    }
    // ~ and ~/ at a word's start are the home folder.
    if (c === "~" && word === null && /^[/\s]?$/.test(src[i + 1] ?? "")) {
      word = os.homedir();
      continue;
    }
    word = (word ?? "") + c;
  }
  endCmd();
  return out;
}
