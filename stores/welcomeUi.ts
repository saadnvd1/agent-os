import { proxy } from "valtio";
import { WELCOME_STEPS, type WelcomeStep } from "@/lib/welcome-url";

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
  // A project picked or added: remember it and move to the step after "project".
  chooseProject: (projectId: string) => {
    welcomeUi.projectId = projectId;
    welcomeUi.step = WELCOME_STEPS[WELCOME_STEPS.indexOf("project") + 1];
  },
  close: () => {
    welcomeUi.open = false;
  },
};
