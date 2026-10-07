import dynamic from "next/dynamic";

// Dialogs both views hold closed until asked for: their code loads after the
// first paint rather than with it.
export const NewSessionDialog = dynamic(
  () => import("@/components/NewSessionDialog").then((m) => m.NewSessionDialog),
  { ssr: false }
);
export const QuickSwitcher = dynamic(
  () => import("@/components/QuickSwitcher").then((m) => m.QuickSwitcher),
  { ssr: false }
);
export const StartServerDialog = dynamic(
  () =>
    import("@/components/DevServers/StartServerDialog").then(
      (m) => m.StartServerDialog
    ),
  { ssr: false }
);
