import { z } from "zod";

export const CONDITIONS = [
  "no-paired-device",
  "no-push-device",
  "connect-not-linked",
  "connect-linked",
  "no-schedules",
  "no-recipes",
  "no-shares",
  "no-groups",
  "no-bookmarks",
] as const;
export type Condition = (typeof CONDITIONS)[number];

const media = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("image"),
    src: z.string().startsWith("/tips/"),
    srcDark: z.string().startsWith("/tips/").optional(),
    alt: z.string().min(1).max(200),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("video"),
    src: z.string().startsWith("/tips/"),
    poster: z.string().startsWith("/tips/"),
    alt: z.string().min(1).max(200),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    durationMs: z.number().int().positive(),
  }),
]);
export type Media = z.infer<typeof media>;

const mediaBrief = z.object({
  kind: z.enum(["screenshot", "crop", "clip"]),
  shot: z.string().min(1).max(300),
  theme: z.enum(["light", "dark", "both"]).optional(),
});
export type MediaBrief = z.infer<typeof mediaBrief>;

export const tipSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().min(1).max(60),
  body: z.string().min(1).max(240),
  guide: z
    .object({
      file: z.string().regex(/^[a-z0-9-]+$/),
      anchor: z.string().optional(),
    })
    .optional(),
  when: z.array(z.enum(CONDITIONS)).optional(),
  added: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hidden: z.boolean().optional(),
  media: media.optional(),
  mediaBrief: mediaBrief.optional(),
});
export type Tip = z.infer<typeof tipSchema>;

export const fileSchema = z.object({
  v: z.literal(1),
  tips: z.array(tipSchema),
});

/** What a client gets: the guide resolved to a link, the brief left out. */
export interface ClientTip {
  id: string;
  title: string;
  body: string;
  url?: string;
  media?: Media;
}

export interface TipsView {
  off: boolean;
  /** Setup isn't finished: the button works but shows no dot. */
  quiet: boolean;
  today: { id: string; read: boolean } | null;
  deck: ClientTip[];
}
