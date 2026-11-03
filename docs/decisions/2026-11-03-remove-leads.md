# Remove the leads system

Date: 2026-11-03

**Decision.** The leads experiment (a chief of staff plus department leads per workspace) is removed from the code, not just hidden. Git history keeps it.

**Why.** It was switched off and not going to be used; carrying its role checks, tools, tables and UI through the orchestrator, sidebar and chat code cost more than it gave.

**What stays.** The orchestrator is "<workspace> orchestrator" again. Clicking a workspace card under All workspaces still opens that workspace's orchestrator chat without leaving the view. The fast-checks work is untouched.

**Data.** Migration `20261103T0200_remove_leads` takes a full database copy first, then drops the lead tables and columns. A chat adopted as a lead becomes a plain session with its original name, project and history. Sessions made as leads (the chief, a design lead) are archived, not deleted. Notes and asks written by the chief or a lead are deleted from the shared tables (the copy has them). The shipped lead migrations stay in place, since a shipped migration is never edited.
