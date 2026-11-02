import { getSetting, putSetting } from "./settings-store";
import { cleanOwnerName, ownerInPrompt, ownerInUi } from "./owner-label";

export const OWNER_NAME_KEY = "owner.name";

/** The name the installation's owner set, or null. The one reader. */
export function ownerName(): string | null {
  return cleanOwnerName(getSetting(OWNER_NAME_KEY));
}

export function setOwnerName(raw: unknown): string | null {
  const name = cleanOwnerName(raw);
  putSetting(OWNER_NAME_KEY, name);
  return name;
}

/** For agent text: "Alex" or "the owner". */
export const owner = () => ownerInPrompt(ownerName());
export const Owner = () => ownerInPrompt(ownerName(), true);
/** For text people read: "Alex" or "you". */
export const ownerUi = (cap = false) => ownerInUi(ownerName(), cap);
