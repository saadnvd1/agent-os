import { z } from "zod";

export const KINDS = ["new", "improved", "fixed"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
};

export const entrySchema = z.object({
  id: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(KINDS),
  area: z.string().min(1).max(40),
  text: z.string().min(1).max(280),
  note: z.string().max(400).optional(),
  url: z.string().optional(),
  hidden: z.boolean().optional(),
});
export type Entry = z.infer<typeof entrySchema>;

export const fileSchema = z.object({
  v: z.literal(1),
  entries: z.array(entrySchema),
});
export type WhatsNewFile = z.infer<typeof fileSchema>;

export interface Head {
  latestId: number;
  latestDate: string | null;
  count: number;
  /** Ids of the newest few, so the footer can count unread without the list. */
  recent: number[];
}

export interface Page {
  entries: Entry[];
  hasMore: boolean;
}
