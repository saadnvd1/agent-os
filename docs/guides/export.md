# Export a session for AI

**Export for AI…** turns a chat into a file you can paste or upload into another model. It is in the pane's ⋯ menu, a session's row menu, the phone's session menu, and on each of your messages (**Export from here**). Nothing leaves your machine: the server builds the file and your browser saves, copies or shares it.

## What you choose

- **Format.** Markdown (best for pasting into a chat), JSON (for scripts) or HTML (a page to read or upload).
- **Detail.** **Compact** is the default and keeps a long session inside a model's context window: thinking is dropped, tool and command output keeps its first 10 and last 20 lines (2,000 characters at most), tool input is clipped to 300 characters (a shell command to 1,000), file changes become `+added −removed`, only the last to-do list of each turn is kept, pages the agent showed keep their title, and a pasted block over 8,000 characters keeps its start and end. **Full** keeps everything except one field over 200,000 characters.
- **Range.** The whole session, the last turn, the last 5, since the last compaction, or custom turns. A turn is one of your messages and everything the agent did until your next one. **Select in chat** lets you tick the first and last turn in the conversation itself.
- **Masking.** The same masking as Share: credentials, home paths, addresses, machine names and emails. Turn it off to keep paths, hosts and emails (they are often what an analysis needs); credentials are always masked.

The sheet shows the size and an approximate token count (about four characters a token) before you export, and warns when a file is larger than most context windows, when full tool output may hold file contents, and when credentials were found. Over 25 MB it won't export; narrow the range or use Compact.

**Copy for agent** copies the file's text (Markdown by default). **Download** saves it. **Share…** hands it to the phone's share sheet where the browser allows it.

## Nothing is cut silently

Every cut is marked where it happens (`[truncated: showing first 10 and last 20 of 412 lines; 382 lines omitted (Compact export)]`, `[omitted: 12 thinking blocks (Compact export)]`) and summarised under **Export notes** at the top, with the range, the masking and the times' time zone. In JSON, each cut item has a `truncated` object with the line and character counts, and the file has `omissions` and `truncations` totals.

Only chat sessions can be exported. Share and Export are separate: Share is a read-only link for a person; Export is a file for a model.

## For other clients (the API)

- `POST /api/sessions/:id/export/estimate` takes `{ format, mode, range?, redact }` (`format` is `md`, `json` or `html`; `mode` is `full` or `compact`; `redact` is `all` or `secrets`; `range` is `{ from, to }`, `{ last }` or `{ sinceCompaction: true }`, by turn) and returns the turns, sizes in each mode, masking counts and warnings, with no file text.
- `POST /api/sessions/:id/export` takes the same body and returns the file with `Content-Disposition`, `X-Export-Bytes` and `X-Export-Tokens`. 400 for a bad request or a terminal session, 404 for an unknown session, 413 over 25 MB.
