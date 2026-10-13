import { redirect } from "next/navigation";

// Reopens the first-run welcome.
export default function WelcomePage() {
  redirect("/?welcome=agents");
}
