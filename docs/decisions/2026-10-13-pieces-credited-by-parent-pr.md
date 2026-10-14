# A parent's PR credits the pieces it built; a repeat is held

**Decision.** A piece takes a merge only from a task in its own project. When a
plan's task merges its PR, the pieces it built in that repository are marked
merged with that PR and never started again. A waiting piece whose repository
already holds an unaccounted merged PR of the same feature is held, not
started.

**Why.** A plan split into two repositories had its first piece (the other
repository) bound to the planning task, which worked in the second. The task's
PR was recorded against the first piece, and the second piece, already built
by that PR, was started as a new task and then dropped.

**Rules.**

1. A bound session that merged in another project does not merge the piece. The
   piece is held with the PR and project named, and the orchestrator is told
   once. A person drops it or releases it.
2. When the planning task merges: if a piece in its repository is bound to it,
   only that piece is credited (the existing path). Otherwise every piece
   still waiting in its repository is marked merged with the task's session and
   PR, and the orchestrator is told once. Building, blocked and dropped pieces
   are never touched.
3. If the planning task has a recorded scope change, nothing is credited: the
   amended brief may cover only part, and free text can't be read
   deterministically. Rule 4 asks a person instead.
4. Before a waiting piece starts, the feature's merged sessions in the piece's
   repository are checked. One that no merged piece there accounts for may
   already contain the piece, so the piece is held and the orchestrator told
   once. "Release anyway" skips the check for that piece.

**Alternatives.** Parsing the brief or the PR diff to decide what was built
(non-deterministic, and a wrong credit loses work silently); crediting every
piece in the repository regardless of scope changes; blocking the planning
task from working outside its first piece (it already can't since pieces are
routed by repository).

**Consequences.** A wrong hold costs one question; a wrong credit costs
unbuilt work. Only merged PRs are checked: an open PR of the parent does not
hold a piece, and a stray PR opened outside its task's repository is left to
the reconcile sweep. Features already closed are not rewritten.

**Repo names.** A piece's `(repo: …)` resolves by project name, then by the
repository's folder name, then by its GitHub `owner/name` (or the name part),
ignoring case. A folder or GitHub match that fits two projects is refused as
ambiguous, as is a name that matches none.
