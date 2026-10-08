import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { WATCHED_TABLES } from "@/lib/db/changes";
import { gitKeys } from "../git/keys";
import { sessionKeys } from "../sessions/keys";
import { ALL_TOPICS, invalidateTopics, topicKeys } from "./topics";

describe("pushed topics", () => {
  it("refetches something for every table the triggers watch", () => {
    for (const table of WATCHED_TABLES)
      expect(topicKeys(table), table).not.toEqual([]);
  });

  it("covers every topic a snapshot refetches", () => {
    for (const topic of ALL_TOPICS)
      expect(topicKeys(topic), topic).not.toEqual([]);
  });

  it("maps a git folder and a session's setup to their queries", () => {
    expect(topicKeys("git:~/app")).toContainEqual(gitKeys.status("~/app"));
    expect(topicKeys("git:~/app")).toContainEqual([
      ...gitKeys.all,
      "multi-status",
    ]);
    expect(topicKeys("setup:s1")).toEqual([
      [...sessionKeys.all, "setup", "s1"],
    ]);
  });

  it("with fetchedBefore, refetches only what was fetched before then", async () => {
    const client = new QueryClient();
    client.setQueryData(sessionKeys.list(), [], { updatedAt: 1000 });
    client.setQueryData(
      [...sessionKeys.all, "setup", "x"],
      {},
      { updatedAt: 3000 }
    );
    invalidateTopics(client, ["sessions"], 2000);
    expect(client.getQueryState(sessionKeys.list())?.isInvalidated).toBe(true);
    expect(
      client.getQueryState([...sessionKeys.all, "setup", "x"])?.isInvalidated
    ).toBe(false);
  });
});
