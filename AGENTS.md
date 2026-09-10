# MindDiary Engineering Instructions

Use the smallest workflow that completes the user's requested outcome. Preserve unrelated work and validate changes with checks relevant to the requested behavior.

## Workflow selection

Ordinary repository work is the default. Use zero to two available skills only when they materially improve the task; check their availability and invocation conditions rather than assuming a named skill is installed. Avoid fixed skill chains and unnecessary review or planning stages. User instructions and repository constraints take precedence over skill guidance. Skills never authorize external writes.

## Product direction

Preserve MindDiary's current UI direction as defined in DESIGN.md: calm, focused, structured, modern, polished, trustworthy, and visually quiet without becoming dull. Prioritize legibility, accessibility, familiar interactions, and clear content hierarchy.

Put learning content before chrome and keep AI presentation subordinate to it. Favor open surfaces, aligned groups, selective containment, and efficient desktop density. Avoid drifting into generic SaaS, crypto, glassmorphism, or stereotypical AI-app styling. Explicitly approved visual directions take precedence.

## Context to load when relevant

Use these pointers when the task needs the corresponding workflow or changes or directly depends on the contract. Merely touching a nearby file does not require loading the documents.

- **GitHub issues or specs:** `docs/agents/issue-tracker.md`. Issues and specs live in GitHub Issues; read the conventions when working with them, not before every local change.
- **Domain terminology or durable design decisions:** `docs/agents/domain.md` for the single-context layout and relevant domain documentation.
- **Preload, IPC, or another privileged Electron contract:** `docs/agents/electron-boundaries.md`.
- **SQLite, migrations, import/export, backup/restore, or managed-file contracts:** `docs/agents/persistence.md`.
- **AI providers, transmitted context, attachments, model-derived actions, or privacy projection:** `docs/agents/ai-contracts.md`.
- **Packaging, updater, release, tag, or publication:** the relevant parts of `.github/workflows/release.yml`, `docs/release-checklist.md`, and the release scripts used by the task.

## External workflow boundary

Pushes, issue mutations, PR changes, tags, releases, and publication require explicit user authorization unless already authorized in the conversation. Prepare the local change and relevant evidence before asking for any missing external authorization; continue an authorized workflow to its agreed stopping point.
