"use client";

import dynamic from "next/dynamic";
import { useAwayQuery } from "@/data/away";

const AwayReportDialog = dynamic(
  () => import("./AwayReportDialog").then((m) => m.AwayReportDialog),
  { ssr: false }
);

// Opens "While you were away" when Away has ended and its report hasn't
// been dismissed, on whichever device is open.
export function AwayReport() {
  const { data } = useAwayQuery();
  return data?.report ? <AwayReportDialog report={data.report} /> : null;
}
