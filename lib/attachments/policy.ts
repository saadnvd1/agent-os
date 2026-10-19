// What a chat may carry besides typed text, and how big. The server owns it:
// the upload route enforces it and /api/client-config hands it to clients, so
// no client keeps its own copy. No Node imports: the browser reads this too.

export type AttachmentKind = "image" | "pdf" | "sheet" | "doc" | "text";

export interface AttachmentType {
  ext: string;
  mediaType: string;
  kind: AttachmentKind;
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
  ...t("text", "text/plain", "txt", "log", "env"),
  ...t("text", "text/markdown", "md", "markdown"),
  ...t("text", "application/json", "json", "jsonl", "ipynb"),
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
    "patch"
  ),
];

export const ATTACHMENT_LIMITS = {
  // Files and images on one message.
  max: 8,
  // One non-image file.
  maxBytes: 25_000_000,
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

export const typeFor = (
  name: string,
  types: AttachmentType[] = ATTACHMENT_TYPES
): AttachmentType | null =>
  types === ATTACHMENT_TYPES
    ? (BY_EXT.get(extOf(name)) ?? null)
    : (types.find((x) => x.ext === extOf(name)) ?? null);

// For <input accept>: every extension, so the picker greys out the rest.
export const acceptAttr = (types: AttachmentType[] = ATTACHMENT_TYPES) =>
  types.map((x) => `.${x.ext}`).join(",");

export const formatBytes = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1000))} KB`;

// What a person is told when a file can't be attached.
export const unsupportedMessage = (name: string): string =>
  `${name}: this file type can't be attached. Supported: PDF, spreadsheets (xlsx, xls, csv), Word (docx), text, markdown, JSON, code and images.`;

export const tooBigMessage = (name: string, size: number, limit: number) =>
  `${name} is ${formatBytes(size)}; the limit is ${formatBytes(limit)}.`;
