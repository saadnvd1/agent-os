export type { SessionGroup } from "@/lib/sidebar/shelves";

export type GroupErrorCode =
  "not-found" | "duplicate" | "workspace" | "invalid" | "deleted";

// Thrown for anything the caller got wrong; routes map the code to a status.
export class GroupError extends Error {
  constructor(
    readonly code: GroupErrorCode,
    message: string
  ) {
    super(message);
    this.name = "GroupError";
  }
}

export const GROUP_STATUS: Record<GroupErrorCode, number> = {
  "not-found": 404,
  duplicate: 409,
  workspace: 409,
  invalid: 400,
  deleted: 409,
};

export const NAME_MAX = 60;
