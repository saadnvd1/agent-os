// What the demo's terminal sessions show. Each screen reads like an agent CLI
// mid-session; the status detector reads the same text a real one would
// ("esc to interrupt" = working, "Do you want to" = needs you).

const c = (code: string) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
const dim = c("38;5;244");
const bold = c("1");
const ok = c("38;5;71");
const accent = c("38;5;141");
const warn = c("38;5;179");

const step = (tool: string, arg: string) =>
  `${ok("●")} ${bold(tool)}${dim(`(${arg})`)}`;
const out = (...lines: string[]) =>
  lines.map((l, i) => `  ${i === 0 ? dim("⎿") : " "}  ${l}`).join("\n");
const say = (text: string) => `${"●"} ${text}`;
const prompt = (text: string) => `${dim(">")} ${text}`;

const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
const WIDTH = 66;
const box = (title: string, lines: string[]) => [
  warn(`╭─ ${title} ${"─".repeat(WIDTH - title.length - 4)}╮`),
  ...lines.map(
    (l) => `${warn("│")}  ${l}${" ".repeat(WIDTH - 3 - visible(l))}${warn("│")}`
  ),
  warn(`╰${"─".repeat(WIDTH - 1)}╯`),
];

export interface PaneScreen {
  title: string;
  screen: string;
}

const working = (verb: string, secs: string) =>
  `${accent("✶")} ${accent(`${verb}…`)} ${dim(`(${secs} · ↓ 3.1k tokens · esc to interrupt)`)}`;

export const PANES: Record<string, PaneScreen> = {
  webhooks: {
    title: "✳ Webhook retries with backoff",
    screen: [
      prompt("Why do some merchants get the same webhook five times a minute?"),
      "",
      step("Grep", 'pattern: "scheduleRetry"'),
      out(dim("Found 3 files")),
      "",
      say(
        "Retries fire every 30 seconds with no cap, so an endpoint that is down"
      ),
      "  for a few minutes gets hammered. Backoff with a limit would fix it.",
      "",
      prompt(
        "Make webhook retries back off exponentially and stop after 6 attempts."
      ),
      "",
      step("Read", "internal/webhooks/retry.go"),
      out(dim("Read 64 lines")),
      "",
      step("Update", "internal/webhooks/retry.go"),
      out(
        dim("Updated retry.go with 9 additions and 3 removals"),
        `${dim("41")} ${c("38;5;174")("-  delay := 30 * time.Second")}`,
        `${dim("41")} ${ok("+  delay := backoff(attempt, 2*time.Second, 5*time.Minute)")}`,
        `${dim("42")} ${ok("+  if attempt >= maxAttempts {")}`,
        `${dim("43")} ${ok("+      return ErrGiveUp")}`,
        `${dim("44")} ${ok("+  }")}`
      ),
      "",
      step("Bash", "go test ./internal/webhooks/... -race"),
      out(
        "=== RUN   TestRetrySchedule",
        `${ok("--- PASS")}: TestRetrySchedule (0.00s)`,
        "=== RUN   TestRetryStopsAfterSixAttempts",
        `${ok("--- PASS")}: TestRetryStopsAfterSixAttempts (0.01s)`,
        "=== RUN   TestSignatureHeader",
        `${ok("--- PASS")}: TestSignatureHeader (0.00s)`,
        ok("PASS"),
        `${ok("ok")}  	example.com/payments/internal/webhooks	1.284s`
      ),
      "",
      say(
        "Unit tests pass. Next, the integration suite against local Postgres."
      ),
      "",
      ...box("Bash command", [
        "make test-integration",
        dim("Run integration tests against local Postgres"),
      ]),
      " Do you want to proceed?",
      ` ${accent("❯ 1. Yes")}`,
      "   2. Yes, and don't ask again for make commands",
      "   3. No, and tell the agent what to do differently",
    ].join("\n"),
  },
  flakyCart: {
    title: "⠂ Fix flaky cart quantity test",
    screen: [
      prompt("The cart quantity test fails about one run in ten. Fix it."),
      "",
      step("Read", "src/cart/useCart.test.ts"),
      out(dim("Read 84 lines")),
      "",
      say(
        "The test asserts before the 250ms debounce settles. Switching it to fake timers."
      ),
      "",
      step("Update", "src/cart/useCart.test.ts"),
      out(dim("Updated useCart.test.ts with 6 additions and 2 removals")),
      "",
      step(
        "Bash",
        "for i in $(seq 20); do npx vitest run src/cart || break; done"
      ),
      out(dim("Running…")),
      "",
      working("Verifying", "1m 12s"),
    ].join("\n"),
  },
  offlineSync: {
    title: "⠐ Queue writes while offline",
    screen: [
      prompt(
        "Queue writes while the phone is offline and replay them in order."
      ),
      "",
      step("Grep", 'pattern: "useMutation"'),
      out(dim("Found 14 files")),
      "",
      step("Write", "src/sync/outbox.ts"),
      out(dim("Wrote 72 lines to src/sync/outbox.ts")),
      "",
      working("Wiring the outbox into mutations", "48s"),
    ].join("\n"),
  },
  backfill: {
    title: "⠠ Backfill 90 days of features",
    screen: [
      prompt("Backfill the feature store for the last 90 days."),
      "",
      step("Bash", "python -m jobs.backfill --days 90 --workers 8"),
      out("day 61/90  ████████████████████░░░░░░░░  68%", dim("eta 4m")),
      "",
      working("Backfilling", "6m 03s"),
    ].join("\n"),
  },
  idempotency: {
    title: "✳ Idempotency keys on POST /charges",
    screen: [
      prompt("Add idempotency keys to POST /charges and open a PR."),
      "",
      step("Bash", "gh pr create --fill"),
      out("https://github.com/example/payments-api/pull/214"),
      "",
      say("PR #214 is open and CI is green. Ready for review."),
    ].join("\n"),
  },
  dbCreds: {
    title: "✳ Rotate staging database credentials",
    screen: [
      prompt("Rotate the staging database credentials."),
      "",
      step("Bash", "terraform plan -target=module.db"),
      out(dim("Plan: 1 to add, 0 to change, 1 to destroy.")),
      "",
      say("The plan replaces the staging DB user. Apply it?"),
      "",
      " Do you want to proceed?",
      ` ${accent("❯ 1. Yes")}`,
      "   2. No, and tell the agent what to do differently",
    ].join("\n"),
  },
};
