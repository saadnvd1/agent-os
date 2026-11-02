import { describe, expect, it } from "vitest";
import { describeApproval, looksLikeCommand } from "./describe";
import type { AuditRow } from "./no-approvals";

const row = (source: AuditRow["source"], subject: string): AuditRow => ({
  id: 1,
  at: "2026-11-02 10:00:00",
  source,
  workspace_id: null,
  session_id: null,
  subject,
  detail: "",
});

describe("describeApproval", () => {
  it("says a shell command in words and keeps the command as details", () => {
    const line = describeApproval(row("chat", "Bash: ssh root@host 'ls /tmp'"));
    expect(line.summary).toBe("Ran a command");
    expect(line.details).toBe("ssh root@host 'ls /tmp'");
    expect(line.summary).not.toMatch(/ssh|root@/);
  });

  it("recognises commands without a tool prefix", () => {
    expect(looksLikeCommand("cd /tmp/x && rm -rf build")).toBe(true);
    expect(looksLikeCommand('money ask "Pay the invoice?"')).toBe(false);
  });

  it("leaves a sentence alone", () => {
    const line = describeApproval(row("ask", 'money ask "Pay the invoice?"'));
    expect(line).toMatchObject({
      summary: 'money ask "Pay the invoice?"',
      details: null,
    });
  });

  it("turns a terminal tool name into words", () => {
    expect(
      describeApproval(row("terminal", "Bash in a terminal session")).summary
    ).toBe("Ran a command");
    expect(
      describeApproval(row("terminal", "Edit in a terminal session")).summary
    ).toBe("Changed a file");
    expect(
      describeApproval(row("terminal", "WebFetch in a terminal session"))
        .summary
    ).toBe("Used WebFetch");
  });
});
