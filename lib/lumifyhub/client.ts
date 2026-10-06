import type {
  LhBoard,
  LhCard,
  LhList,
  LhListCategory,
  LhUser,
  LhWorkspace,
} from "./types";

export const DEFAULT_BASE_URL = "https://lumifyhub.io";

export function configuredBaseUrl(): string {
  return (process.env.AGENTOS_LUMIFYHUB_URL || DEFAULT_BASE_URL).replace(
    /\/+$/,
    ""
  );
}

export class LumifyHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // The token was refused: the connection is gone until the user reconnects.
    readonly disconnected = false
  ) {
    super(message);
    this.name = "LumifyHubError";
  }
}

type Fetch = typeof fetch;

const seg = encodeURIComponent;

export class LumifyHubClient {
  constructor(
    readonly baseUrl: string,
    private readonly token: string | null,
    private readonly fetchImpl: Fetch = fetch
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // A redirect (lumifyhub.io → www.) would drop the Authorization header.
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new LumifyHubError(`LumifyHub unreachable: ${reason}`, 0);
    }
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
    } & T;
    if (res.status === 401) {
      throw new LumifyHubError("LumifyHub disconnected", 401, true);
    }
    if (!res.ok) {
      throw new LumifyHubError(
        data.error || `LumifyHub answered ${res.status}`,
        res.status
      );
    }
    return data;
  }

  private async data<T>(method: string, path: string, body?: unknown) {
    return (await this.request<{ data: T }>(method, path, body)).data;
  }

  validate() {
    return this.request<{ valid: boolean; userId: string; email: string }>(
      "GET",
      "/api/cli/auth/validate"
    );
  }

  exchangeCode(input: {
    code: string;
    code_verifier: string;
    redirect_uri: string;
  }) {
    return this.request<{ token: string; user: LhUser }>(
      "POST",
      "/api/cli/connect/token",
      input
    );
  }

  listWorkspaces() {
    return this.data<LhWorkspace[]>("GET", "/api/cli/workspaces");
  }

  createWorkspace(name: string) {
    return this.data<LhWorkspace>("POST", "/api/cli/workspaces", { name });
  }

  listBoards(workspace: string) {
    return this.data<LhBoard[]>(
      "GET",
      `/api/cli/boards?workspace=${encodeURIComponent(workspace)}`
    );
  }

  createBoard(workspaceSlug: string, title: string) {
    return this.data<LhBoard>("POST", "/api/cli/boards", {
      workspace_slug: workspaceSlug,
      title,
    });
  }

  deleteBoard(boardId: string) {
    return this.data<{ id: string; deleted: boolean }>(
      "DELETE",
      `/api/cli/boards/${seg(boardId)}`
    );
  }

  listLists(boardId: string) {
    return this.data<LhList[]>("GET", `/api/cli/boards/${seg(boardId)}/lists`);
  }

  createList(
    boardId: string,
    input: { name: string; category: LhListCategory; position?: number }
  ) {
    return this.data<LhList>(
      "POST",
      `/api/cli/boards/${seg(boardId)}/lists`,
      input
    );
  }

  updateList(boardId: string, listId: string, input: { position: number }) {
    return this.data<LhList>(
      "PUT",
      `/api/cli/boards/${seg(boardId)}/lists/${seg(listId)}`,
      input
    );
  }

  listCards(boardId: string, listId?: string) {
    const q = listId ? `?list_id=${encodeURIComponent(listId)}` : "";
    return this.data<LhCard[]>(
      "GET",
      `/api/cli/boards/${seg(boardId)}/cards${q}`
    );
  }

  getCard(boardId: string, cardId: string) {
    return this.data<LhCard>(
      "GET",
      `/api/cli/boards/${seg(boardId)}/cards/${seg(cardId)}`
    );
  }

  createCard(
    boardId: string,
    input: { list_id: string; title: string; description?: string }
  ) {
    return this.data<LhCard>(
      "POST",
      `/api/cli/boards/${seg(boardId)}/cards`,
      input
    );
  }

  moveCard(boardId: string, cardId: string, listId: string) {
    return this.data<LhCard>(
      "PUT",
      `/api/cli/boards/${seg(boardId)}/cards/${seg(cardId)}`,
      { list_id: listId }
    );
  }

  addComment(boardId: string, cardId: string, content: string) {
    return this.data<{ id: string }>(
      "POST",
      `/api/cli/boards/${seg(boardId)}/cards/${seg(cardId)}/comments`,
      { content }
    );
  }
}
