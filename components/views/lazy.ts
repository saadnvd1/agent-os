import dynamic from "next/dynamic";

// Dialogs both views hold closed until asked for: their code loads after the
// first paint rather than with it.
export const CodeSearchDialog = dynamic(
  () => import("@/components/CodeSearchDialog").then((m) => m.CodeSearchDialog),
  { ssr: false }
);
export const StartServerDialog = dynamic(
  () =>
    import("@/components/DevServers/StartServerDialog").then(
      (m) => m.StartServerDialog
    ),
  { ssr: false }
);
