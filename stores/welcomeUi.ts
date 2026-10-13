import { proxy } from "valtio";
import type { WelcomeStep } from "@/lib/welcome-url";

// The first-run welcome: whether it is on show, the step, and the project
// the user made (or picked) to start in.
export const welcomeUi = proxy<{
  open: boolean;
  step: WelcomeStep;
  projectId: string | null;
}>({ open: false, step: "agents", projectId: null });

export const welcomeUiActions = {
  open: (step: WelcomeStep = "agents") => {
    welcomeUi.step = step;
    welcomeUi.open = true;
  },
  go: (step: WelcomeStep) => {
    welcomeUi.step = step;
  },
  setProject: (projectId: string | null) => {
    welcomeUi.projectId = projectId;
  },
  close: () => {
    welcomeUi.open = false;
  },
};
