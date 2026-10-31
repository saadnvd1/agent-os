// "New" above the first thing that arrived while the reader was away.
export function NewDivider() {
  return (
    <div
      data-new-divider
      role="separator"
      aria-label="New messages"
      className="text-primary mx-auto flex w-full max-w-3xl items-center gap-3 px-4 pb-3 text-xs font-medium"
    >
      <span className="bg-primary/40 h-px flex-1" />
      New
      <span className="bg-primary/40 h-px flex-1" />
    </div>
  );
}
