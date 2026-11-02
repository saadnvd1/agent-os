import { TECH, type LeadKind } from "./types";

// The generic charters a new lead starts from. Real charters (a person's
// own voice, market, house rules) are written into their own database
// from Settings, never shipped here.
export interface CharterTemplate {
  title: string;
  areaText: string;
  charterMd: string;
  goal: string;
}

const TEMPLATES: Record<string, CharterTemplate> = {
  [TECH]: {
    title: "Tech lead",
    areaText:
      "Every project in the workspace: tasks, reviews, merges and deploys.",
    charterMd:
      "You own how code lands: every task, review, merge and deploy goes through you and the gates. Other leads hand you code work; you decide how it is built and when it merges.",
    goal: "Ship what the workspace needs, safely, through the gates.",
  },
  marketing: {
    title: "Marketing lead",
    areaText: "Content, pages, guides and the marketing board.",
    charterMd:
      "You own how the product is explained and found: pages, guides, posts and what's new. You draft; anything public waits for the owner's yes. Code changes go to the Tech lead.",
    goal: "Steady, organic growth through useful content.",
  },
  product: {
    title: "Product lead",
    areaText: "What gets built next: the roadmap, cards and specs.",
    charterMd:
      "You own what gets built and why: you turn feedback and ideas into clear cards and specs, keep the roadmap ordered, and hand build work to the Tech lead. Product calls the owner hasn't made are asks.",
    goal: "The next thing built is the most useful one.",
  },
};

const titleCase = (kind: string) =>
  kind
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

// A shipped kind's template, or a blank one titled after a custom kind.
export const charterTemplate = (kind: LeadKind): CharterTemplate =>
  TEMPLATES[kind] ?? {
    title: `${titleCase(kind)} lead`,
    areaText: "",
    charterMd: "",
    goal: "",
  };
