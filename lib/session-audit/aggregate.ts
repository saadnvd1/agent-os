/**
 * Per-transcript stats folded into the audit's summary: each session's
 * numbers, and across sessions the repeats (commands, files, errors,
 * messages) that point at waste or at work a script should do.
 */

import type { ManualClass, WasteClass } from "./normalize";
import type { AuditSession, DbSignals, SessionKind } from "./sources";
import type { ToolCall, TranscriptStats } from "./transcript";

export interface SessionInput {
  session: AuditSession;
  main: TranscriptStats[];
  subagents: { type: string; description: string; stats: TranscriptStats }[];
}

interface Example {
  session: string;
  excerpt: string;
}

export interface PatternStat {
  calls: number;
  sessions: number;
  tokens: number;
  carried: number;
  examples: Example[];
}

export interface SessionSummary {
  id: string;
  name: string;
  kind: SessionKind;
  project: string | null;
  transcripts: number;
  turns: number;
  tokensRead: number;
  tokensWritten: number;
  peakContext: number;
  readPast300k: number;
  ceiling150k: number;
  baselineContext: number | null;
  compactions: number;
  briefChars: number;
  costUsd: number | null;
  toolCalls: Record<string, number>;
  subagents: { count: number; tokensRead: number };
  biggestOutputs: {
    tool: string;
    excerpt: string;
    tokens: number;
    carried: number;
  }[];
  rereads: number;
}

export interface Summary {
  version: 1;
  generatedAt: string;
  range: { since: string; until: string };
  totals: {
    sessions: number;
    transcripts: number;
    turns: number;
    tokensRead: number;
    tokensWritten: number;
    subagentTokensRead: number;
    readPast300k: number;
    ceiling150k: number;
    sessionsPast300k: number;
    toolCalls: number;
    toolOutputTokens: number;
    carriedTokens: number;
    chatCostUsd: number;
  };
  byKind: Record<
    string,
    {
      sessions: number;
      turns: number;
      tokensRead: number;
      medianBaseline: number | null;
      medianPeak: number;
    }
  >;
  sessions: SessionSummary[];
  waste: {
    byClass: Partial<Record<WasteClass, PatternStat>>;
    bigOutputs: {
      session: string;
      tool: string;
      excerpt: string;
      tokens: number;
      carried: number;
    }[];
    repeatedCommands: {
      key: string;
      count: number;
      sessions: number;
      tokens: number;
    }[];
    fileReads: {
      path: string;
      count: number;
      sessions: number;
      tokens: number;
    }[];
    rereads: {
      total: number;
      tokens: number;
      worst: { session: string; path: string; count: number }[];
    };
    pollLoops: {
      session: string;
      tool: string;
      excerpt: string;
      count: number;
    }[];
    duplicateSubagents: {
      session: string;
      type: string;
      description: string;
      count: number;
      tokensRead: number;
    }[];
    subagentsByType: {
      type: string;
      count: number;
      tokensRead: number;
      sessions: number;
    }[];
    resentPrompts: { session: string; chars: number; count: number }[];
    toolTokens: {
      tool: string;
      calls: number;
      tokens: number;
      carried: number;
    }[];
  };
  manual: {
    byClass: Partial<Record<ManualClass, PatternStat>>;
    errors: {
      key: string;
      count: number;
      sessions: number;
      examples: string[];
    }[];
    nudges: {
      count: number;
      sessions: number;
      top: { text: string; count: number; sessions: number }[];
    };
    restarts: { midTurn: number; betweenTurns: number; sessions: number };
  };
  signals: DbSignals;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const top = <T>(xs: T[], by: (x: T) => number, n: number) =>
  [...xs].sort((a, b) => by(b) - by(a)).slice(0, n);

const short = (id: string) => id.slice(0, 8);

function addPattern(
  map: Map<string, PatternStat & { ids: Set<string> }>,
  cls: string,
  call: ToolCall,
  session: string
) {
  const p = map.get(cls) ?? {
    calls: 0,
    sessions: 0,
    tokens: 0,
    carried: 0,
    examples: [],
    ids: new Set<string>(),
  };
  p.calls++;
  p.tokens += call.tokens;
  p.carried += call.carried;
  p.ids.add(session);
  if (
    p.examples.length < 3 &&
    !p.examples.some((e) => e.session === short(session))
  )
    p.examples.push({ session: short(session), excerpt: call.excerpt });
  map.set(cls, p);
}

function finish<K extends string>(
  map: Map<string, PatternStat & { ids: Set<string> }>
): Partial<Record<K, PatternStat>> {
  const out: Partial<Record<K, PatternStat>> = {};
  for (const [cls, p] of [...map].sort(
    (a, b) => b[1].tokens + b[1].carried - (a[1].tokens + a[1].carried)
  )) {
    const { ids, ...rest } = p;
    out[cls as K] = { ...rest, sessions: ids.size };
  }
  return out;
}

export function summarize(
  inputs: SessionInput[],
  signals: DbSignals,
  range: { since: number; until: number }
): Summary {
  const wasteMap = new Map<string, PatternStat & { ids: Set<string> }>();
  const manualMap = new Map<string, PatternStat & { ids: Set<string> }>();
  const commands = new Map<
    string,
    { count: number; ids: Set<string>; tokens: number }
  >();
  const reads = new Map<
    string,
    { count: number; ids: Set<string>; tokens: number }
  >();
  const errors = new Map<
    string,
    { count: number; ids: Set<string>; examples: string[] }
  >();
  const tools = new Map<
    string,
    { calls: number; tokens: number; carried: number }
  >();
  const subTypes = new Map<
    string,
    { count: number; tokensRead: number; ids: Set<string> }
  >();
  const bigOutputs: Summary["waste"]["bigOutputs"] = [];
  const pollLoops: Summary["waste"]["pollLoops"] = [];
  const duplicateSubagents: Summary["waste"]["duplicateSubagents"] = [];
  const resentPrompts: Summary["waste"]["resentPrompts"] = [];
  const rereadWorst: Summary["waste"]["rereads"]["worst"] = [];
  let rereadTotal = 0;
  let rereadTokens = 0;
  const nudgeTexts = new Map<string, { count: number; ids: Set<string> }>();
  let nudgeCount = 0;
  const nudged = new Set<string>();
  let midTurn = 0;
  let betweenTurns = 0;
  const restarted = new Set<string>();

  const sessions: SessionSummary[] = [];
  for (const { session, main, subagents } of inputs) {
    const id = session.id;
    const all = [...main, ...subagents.map((s) => s.stats)];
    const calls = all.flatMap((t) => t.calls);
    const toolCalls: Record<string, number> = {};
    const fileCounts = new Map<string, { count: number; tokens: number }>();
    const exactCounts = new Map<string, { count: number; call: ToolCall }>();

    for (const call of calls) {
      toolCalls[call.tool] = (toolCalls[call.tool] ?? 0) + 1;
      const t = tools.get(call.tool) ?? { calls: 0, tokens: 0, carried: 0 };
      t.calls++;
      t.tokens += call.tokens;
      t.carried += call.carried;
      tools.set(call.tool, t);
      for (const cls of call.waste) addPattern(wasteMap, cls, call, id);
      for (const cls of call.manual) addPattern(manualMap, cls, call, id);
      if (call.tool === "Bash") {
        const c = commands.get(call.key) ?? {
          count: 0,
          ids: new Set<string>(),
          tokens: 0,
        };
        c.count++;
        c.ids.add(id);
        c.tokens += call.tokens;
        commands.set(call.key, c);
      }
      if (call.readPath) {
        const r = reads.get(call.readPath) ?? {
          count: 0,
          ids: new Set<string>(),
          tokens: 0,
        };
        r.count++;
        r.ids.add(id);
        r.tokens += call.tokens;
        reads.set(call.readPath, r);
        const f = fileCounts.get(call.readPath) ?? { count: 0, tokens: 0 };
        f.count++;
        if (f.count > 1) {
          rereadTotal++;
          rereadTokens += call.tokens;
        }
        f.tokens += call.tokens;
        fileCounts.set(call.readPath, f);
      }
      if (call.error) {
        const e = errors.get(call.error) ?? {
          count: 0,
          ids: new Set<string>(),
          examples: [],
        };
        e.count++;
        e.ids.add(id);
        if (e.examples.length < 2)
          e.examples.push(`${short(id)}: ${call.excerpt.slice(0, 120)}`);
        errors.set(call.error, e);
      }
      // Polling a status tool or sleeping on a loop: the same exact call.
      if (
        call.tool !== "Read" &&
        call.tool !== "Edit" &&
        call.tool !== "Write"
      ) {
        const x = exactCounts.get(call.exact) ?? { count: 0, call };
        x.count++;
        exactCounts.set(call.exact, x);
      }
      if (call.tokens >= 5000)
        bigOutputs.push({
          session: short(id),
          tool: call.tool,
          excerpt: call.excerpt,
          tokens: call.tokens,
          carried: call.carried,
        });
    }

    for (const [, x] of exactCounts)
      if (x.count >= 3)
        pollLoops.push({
          session: short(id),
          tool: x.call.tool,
          excerpt: x.call.excerpt,
          count: x.count,
        });
    let sessionRereads = 0;
    for (const [p, f] of fileCounts) {
      if (f.count > 1) sessionRereads += f.count - 1;
      if (f.count >= 3)
        rereadWorst.push({ session: short(id), path: p, count: f.count });
    }

    const byDesc = new Map<
      string,
      { type: string; description: string; count: number; tokensRead: number }
    >();
    for (const sub of subagents) {
      const st = subTypes.get(sub.type) ?? {
        count: 0,
        tokensRead: 0,
        ids: new Set<string>(),
      };
      st.count++;
      st.tokensRead += sub.stats.tokensRead;
      st.ids.add(id);
      subTypes.set(sub.type, st);
      const k = `${sub.type}\u0000${sub.description}`;
      const d = byDesc.get(k) ?? {
        type: sub.type,
        description: sub.description,
        count: 0,
        tokensRead: 0,
      };
      d.count++;
      d.tokensRead += sub.stats.tokensRead;
      byDesc.set(k, d);
    }
    for (const d of byDesc.values())
      if (d.count >= 2) duplicateSubagents.push({ session: short(id), ...d });

    for (const t of main) {
      for (const r of t.resent)
        resentPrompts.push({
          session: short(id),
          chars: r.chars,
          count: r.count,
        });
      for (const inj of t.injected) {
        if (inj.kind === "nudge") {
          nudgeCount++;
          nudged.add(id);
          const n = nudgeTexts.get(inj.text.slice(0, 90)) ?? {
            count: 0,
            ids: new Set<string>(),
          };
          n.count++;
          n.ids.add(id);
          nudgeTexts.set(inj.text.slice(0, 90), n);
        } else {
          if (inj.kind === "restart-mid-turn") midTurn++;
          else betweenTurns++;
          restarted.add(id);
        }
      }
    }

    const sum = (f: (t: TranscriptStats) => number) =>
      main.reduce((s, t) => s + f(t), 0);
    const baselines = main
      .map((t) => t.baselineContext)
      .filter((b): b is number => b !== null);
    sessions.push({
      id,
      name: session.name,
      kind: session.kind,
      project: session.project,
      transcripts: main.length,
      turns: sum((t) => t.turns),
      tokensRead: sum((t) => t.tokensRead),
      tokensWritten: sum((t) => t.tokensWritten),
      peakContext: Math.max(0, ...main.map((t) => t.peakContext)),
      readPast300k: sum((t) => t.readPast300k),
      ceiling150k: sum((t) => t.ceiling150k),
      baselineContext: baselines.length ? Math.max(...baselines) : null,
      compactions: sum((t) => t.compactions),
      briefChars: session.briefChars,
      costUsd: signals.chatCostBySession[id] ?? null,
      toolCalls,
      subagents: {
        count: subagents.length,
        tokensRead: subagents.reduce((s, x) => s + x.stats.tokensRead, 0),
      },
      biggestOutputs: top(calls, (c) => c.tokens + c.carried, 3).map((c) => ({
        tool: c.tool,
        excerpt: c.excerpt,
        tokens: c.tokens,
        carried: c.carried,
      })),
      rereads: sessionRereads,
    });
  }

  const active = sessions.filter((s) => s.turns > 0 || s.subagents.count > 0);
  const byKind: Summary["byKind"] = {};
  for (const kind of new Set(active.map((s) => s.kind))) {
    const ks = active.filter((s) => s.kind === kind);
    byKind[kind] = {
      sessions: ks.length,
      turns: ks.reduce((s, x) => s + x.turns, 0),
      tokensRead: ks.reduce((s, x) => s + x.tokensRead, 0),
      medianBaseline: median(
        ks.map((s) => s.baselineContext).filter((b): b is number => b !== null)
      ),
      medianPeak: median(ks.map((s) => s.peakContext)) ?? 0,
    };
  }

  const allCalls = [...tools.values()];
  const total = (f: (s: SessionSummary) => number) =>
    active.reduce((s, x) => s + f(x), 0);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    range: {
      since: new Date(range.since).toISOString(),
      until: new Date(range.until).toISOString(),
    },
    totals: {
      sessions: active.length,
      transcripts: total((s) => s.transcripts),
      turns: total((s) => s.turns),
      tokensRead: total((s) => s.tokensRead),
      tokensWritten: total((s) => s.tokensWritten),
      subagentTokensRead: total((s) => s.subagents.tokensRead),
      readPast300k: total((s) => s.readPast300k),
      ceiling150k: total((s) => s.ceiling150k),
      sessionsPast300k: active.filter((s) => s.peakContext > 300_000).length,
      toolCalls: allCalls.reduce((s, t) => s + t.calls, 0),
      toolOutputTokens: allCalls.reduce((s, t) => s + t.tokens, 0),
      carriedTokens: allCalls.reduce((s, t) => s + t.carried, 0),
      chatCostUsd: signals.chatCostUsd,
    },
    byKind,
    sessions: top(
      active,
      (s) => s.tokensRead + s.subagents.tokensRead,
      active.length
    ),
    waste: {
      byClass: finish<WasteClass>(wasteMap),
      bigOutputs: top(bigOutputs, (b) => b.tokens + b.carried, 15),
      repeatedCommands: top(
        [...commands]
          .filter(([, c]) => c.count >= 3)
          .map(([key, c]) => ({
            key,
            count: c.count,
            sessions: c.ids.size,
            tokens: c.tokens,
          })),
        (c) => c.count * Math.max(1, c.sessions),
        25
      ),
      fileReads: top(
        [...reads]
          .filter(([, r]) => r.count >= 3)
          .map(([path, r]) => ({
            path,
            count: r.count,
            sessions: r.ids.size,
            tokens: r.tokens,
          })),
        (r) => r.count,
        20
      ),
      rereads: {
        total: rereadTotal,
        tokens: rereadTokens,
        worst: top(rereadWorst, (r) => r.count, 10),
      },
      pollLoops: top(pollLoops, (p) => p.count, 15),
      duplicateSubagents: top(duplicateSubagents, (d) => d.tokensRead, 10),
      subagentsByType: top(
        [...subTypes].map(([type, s]) => ({
          type,
          count: s.count,
          tokensRead: s.tokensRead,
          sessions: s.ids.size,
        })),
        (s) => s.tokensRead,
        15
      ),
      resentPrompts: top(resentPrompts, (r) => r.chars * r.count, 10),
      toolTokens: top(
        [...tools].map(([tool, t]) => ({ tool, ...t })),
        (t) => t.tokens + t.carried,
        15
      ),
    },
    manual: {
      byClass: finish<ManualClass>(manualMap),
      errors: top(
        [...errors]
          .filter(([key]) => key)
          .map(([key, e]) => ({
            key,
            count: e.count,
            sessions: e.ids.size,
            examples: e.examples,
          })),
        (e) => e.count * e.sessions,
        20
      ),
      nudges: {
        count: nudgeCount,
        sessions: nudged.size,
        top: top(
          [...nudgeTexts].map(([text, n]) => ({
            text,
            count: n.count,
            sessions: n.ids.size,
          })),
          (n) => n.count,
          10
        ),
      },
      restarts: { midTurn, betweenTurns, sessions: restarted.size },
    },
    signals,
  };
}
