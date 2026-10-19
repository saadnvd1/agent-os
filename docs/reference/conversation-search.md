# Conversation search

⌘K (Ctrl+K off a Mac), then Tab, searches what was said in every chat.

**What is indexed.** The text of user and assistant messages in chat sessions
(`SEARCHED_KINDS` in `lib/search/conversations/schema.ts`). Tool calls and their
output are not, and terminal sessions are not: their transcripts live in the
agent's own files, outside the database.

**The index.** `chat_search` is an FTS5 table in the main database. Triggers on
`chat_items` keep it current, so every writer (the server, the chat worker
process, an import) is indexed with no code path to forget; a streamed message
rewrites its one row. `chat_search_keys` gives each row a stable FTS rowid,
because `chat_items` has no integer primary key and its rowids can move on a
`VACUUM`.

**Backfill.** The migration only creates the tables and triggers. Chats that
already existed are indexed in the background after the server starts
(`backfill.ts`): 500 rows per transaction, the position stored in
`chat_search_state` in the same transaction, the event loop released between
batches, so it resumes after a restart. `AGENTOS_SEARCH_INDEX=off` skips it.
Raise `SCHEMA_VERSION` to rebuild the index from scratch on the next start.

**Queries.** `buildMatchQuery` quotes every word, so FTS syntax typed by hand
(`AND`, `NEAR`, `*`, `:`, parentheses) is plain text. Bare words match as
prefixes, a closed `"phrase"` matches exactly, an open one matches as a prefix
on its last word. Two letters minimum.

**API.** Read-only, behind the same device gate as the rest of `/api`.
`GET /api/search/conversations?q=&workspace=<id|all>&project=&offset=&limit=`
returns conversations with up to three hits each and the snippet as segments
(`{text, hit}`), never HTML. `GET /api/search/conversations/context?session=&item=`
returns a message and the user and assistant messages around it.

**Opening a result** goes through `openChatAt` (`stores/chatJump.ts`), the path
bookmarks use: the chat loads older history until the message is there, opens
what is folded and scrolls to it, and the message flashes. An archived chat is
brought back first.

**Measuring.** `npx tsx scripts/bench-conversation-search.ts <path to a
database>` copies the database, builds the index on the copy and prints p50 and
p95 per query and the index size.
