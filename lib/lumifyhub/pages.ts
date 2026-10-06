// The pages half of the token API (`/api/cli/pages`). Board, database and
// whiteboard pages never come back from it: the API lists documents only.

import type { LumifyHubClient } from "./client";
import type { LhPage } from "./types";

type Data<T> = { data: T };

export async function listPages(
  client: LumifyHubClient,
  workspaceSlug: string
): Promise<LhPage[]> {
  const res = await client.request<Data<LhPage[]>>(
    "GET",
    `/api/cli/pages?workspace=${encodeURIComponent(workspaceSlug)}`
  );
  return res.data;
}

export async function getPage(
  client: LumifyHubClient,
  pageId: string
): Promise<LhPage> {
  const res = await client.request<Data<LhPage>>(
    "GET",
    `/api/cli/pages/${encodeURIComponent(pageId)}`
  );
  return res.data;
}

export async function createPage(
  client: LumifyHubClient,
  input: { workspace_slug: string; title: string; content: string }
): Promise<LhPage> {
  const res = await client.request<Data<LhPage>>(
    "POST",
    "/api/cli/pages",
    input
  );
  return res.data;
}

export async function updatePage(
  client: LumifyHubClient,
  pageId: string,
  input: { title: string; content: string }
): Promise<LhPage> {
  const res = await client.request<Data<LhPage>>(
    "PUT",
    `/api/cli/pages/${encodeURIComponent(pageId)}`,
    input
  );
  return res.data;
}
