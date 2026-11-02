// Client-safe. A member's name where room is short: "Marketing lead" ->
// "Marketing", "Chief of staff" -> "Chief".
export const shortTitle = (title: string): string =>
  title === "Chief of staff"
    ? "Chief"
    : title.replace(/\s+lead$/i, "") || title;
