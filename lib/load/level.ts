// Machine load as one of three levels. A level is entered above its
// threshold and left only once well below it, so a load hovering at the
// line doesn't flip the gauge (or the alert clock) every sample.
export type LoadLevel = "green" | "amber" | "red";
export type Pressure = "normal" | "warn" | "critical" | null;

export const AMBER_ENTER = 1.5;
export const AMBER_LEAVE = 1.2;
export const RED_ENTER = 3;
export const RED_LEAVE = 2.5;

// perCore: the 1-minute load average divided by the core count.
export function nextLevel(
  prev: LoadLevel,
  perCore: number,
  pressure: Pressure
): LoadLevel {
  if (
    pressure === "critical" ||
    perCore > RED_ENTER ||
    (prev === "red" && perCore > RED_LEAVE)
  )
    return "red";
  if (
    pressure === "warn" ||
    perCore > AMBER_ENTER ||
    (prev !== "green" && perCore > AMBER_LEAVE)
  )
    return "amber";
  return "green";
}
