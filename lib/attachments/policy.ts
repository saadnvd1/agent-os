// What a chat may carry besides typed text, and how big. The server owns it:
// the upload route enforces it and /api/client-config hands it to clients, so
// no client keeps its own copy. No Node imports: the browser reads this too.

export type AttachmentKind = "image" | "pdf" | "sheet" | "doc" | "text";

export interface AttachmentType {
  ext: string;
  mediaType: string;
  kind: AttachmentKind;
  // Shown on the chip: what the server does to this type on the way in.
  note?: string;
}

const t = (
  kind: AttachmentKind,
  mediaType: string,
  ...exts: string[]
): AttachmentType[] => exts.map((ext) => ({ ext, mediaType, kind }));

const OOXML = "application/vnd.openxmlformats-officedocument";

export const ATTACHMENT_TYPES: AttachmentType[] = [
  ...t("image", "image/png", "png"),
  ...t("image", "image/jpeg", "jpg", "jpeg"),
  ...t("image", "image/gif", "gif"),
  ...t("image", "image/webp", "webp"),
  ...t("pdf", "application/pdf", "pdf"),
  ...t("sheet", `${OOXML}.spreadsheetml.sheet`, "xlsx"),
  ...t("sheet", "application/vnd.ms-excel", "xls"),
  ...t("sheet", "text/csv", "csv"),
  ...t("sheet", "text/tab-separated-values", "tsv"),
  ...t("sheet", "application/vnd.oasis.opendocument.spreadsheet", "ods"),
  ...t("doc", `${OOXML}.wordprocessingml.document`, "docx"),
  ...t("doc", "application/msword", "doc"),
  ...t("doc", `${OOXML}.presentationml.presentation`, "pptx"),
  ...t("doc", "application/vnd.oasis.opendocument.text", "odt"),
  ...t("doc", "application/rtf", "rtf"),
  ...t("image", "image/heic", "heic", "heif"),
  ...t("text", "text/plain", "txt", "log", "out", "err", "env"),
  ...t("text", "text/markdown", "md", "markdown"),
  ...t("text", "application/json", "json", "jsonl", "ndjson", "ipynb"),
  {
    ext: "har",
    mediaType: "application/json",
    kind: "text",
    note: "auth headers redacted",
  },
  ...t("text", "text/calendar", "ics"),
  ...t("text", "message/rfc822", "eml"),
  ...t("text", "text/vtt", "vtt"),
  ...t("text", "application/x-subrip", "srt"),
  // Svg is kept as text so nothing ever renders it.
  ...t("text", "text/plain", "svg"),
  ...t(
    "text",
    "text/plain",
    "yaml",
    "yml",
    "toml",
    "xml",
    "html",
    "css",
    "sql",
    "ts",
    "tsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "py",
    "rb",
    "go",
    "rs",
    "java",
    "kt",
    "swift",
    "c",
    "h",
    "cpp",
    "hpp",
    "cs",
    "php",
    "diff",
    "patch",
    "sh",
    "bash",
    "zsh",
    "fish",
    "ini",
    "conf",
    "cfg",
    "properties",
    "tf",
    "tfvars",
    "hcl",
    "graphql",
    "gql",
    "proto",
    "vue",
    "svelte",
    "astro",
    "dart",
    "lua",
    "r",
    "scala",
    "ex",
    "exs",
    "erl",
    "zig",
    "nix",
    "lock",
    "sum",
    "mod",
    "gitignore",
    "gitattributes",
    "dockerignore",
    "editorconfig"
  ),
  // Files that are known by their whole name, matched without a dot.
  ...t(
    "text",
    "text/plain",
    "dockerfile",
    "makefile",
    "gnumakefile",
    "procfile",
    "gemfile",
    "rakefile",
    "brewfile",
    "justfile",
    "env.example",
    "env.sample",
    "env.template"
  ),
];

export const ATTACHMENT_LIMITS = {
  // Files and images on one message.
  max: 8,
  // One document, sheet or PDF.
  maxBytes: 25_000_000,
  // One text file (logs, HAR captures, code). It is saved to disk and opened
  // by the agent from its path, never put into the prompt, so it can be big.
  maxTextBytes: 100_000_000,
  // One image, under the 5 MB a model accepts once base64'd.
  maxImageBytes: 3_750_000,
  // A PDF up to this goes to Claude as a document block; bigger ones, and
  // every other file, are opened by the agent from their path.
  pdfInlineBytes: 10_000_000,
  types: ATTACHMENT_TYPES,
};

export type AttachmentLimits = typeof ATTACHMENT_LIMITS;

const BY_EXT = new Map(ATTACHMENT_TYPES.map((x) => [x.ext, x]));

export const extOf = (name: string): string =>
  /\.([A-Za-z0-9]+)$/.exec(name)?.[1].toLowerCase() ?? "";

// "Dockerfile" and ".env.example" have no extension worth the name; they are
// matched whole, lower-cased and without a leading dot.
const wholeName = (name: string): string =>
  (name.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/^\./, "");

export const typeFor = (
  name: string,
  types: AttachmentType[] = ATTACHMENT_TYPES
): AttachmentType | null => {
  const ext = extOf(name);
  const whole = wholeName(name);
  const find = (key: string) =>
    types === ATTACHMENT_TYPES
      ? BY_EXT.get(key)
      : types.find((x) => x.ext === key);
  return (ext && find(ext)) || find(whole) || null;
};

// iPhone photos: no browser or model reads them, so they are converted on
// intake and kept as files instead of going inline with the message.
export const isHeic = (name: string) => /^heic|^heif/.test(extOf(name));

/** The byte limit for one file of this type. */
export const limitFor = (
  type: AttachmentType,
  limits: Pick<
    typeof ATTACHMENT_LIMITS,
    "maxBytes" | "maxTextBytes" | "maxImageBytes"
  > = ATTACHMENT_LIMITS
): number => {
  if (type.kind === "text") return limits.maxTextBytes;
  if (type.kind === "image" && !isHeic(`x.${type.ext}`))
    return limits.maxImageBytes;
  return limits.maxBytes;
};

// For <input accept>: every extension, so the picker greys out the rest.
export const acceptAttr = (types: AttachmentType[] = ATTACHMENT_TYPES) =>
  types.map((x) => `.${x.ext}`).join(",");

export const formatBytes = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1000))} KB`;

// What a person is told when a file can't be attached.
export const unsupportedMessage = (name: string): string =>
  `${name}: this file type can't be attached. Supported: images (including HEIC), PDF, spreadsheets (xlsx, xls, csv), Word and PowerPoint, HAR captures, SVG, and text files: logs, markdown, JSON, config, shell scripts, Dockerfile, Makefile and source code.`;

export const tooBigMessage = (name: string, size: number, limit: number) =>
  `${name} is ${formatBytes(size)}; the limit is ${formatBytes(limit)}.`;
