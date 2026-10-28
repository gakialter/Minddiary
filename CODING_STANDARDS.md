# Coding standards

## Development and checks

- When changing a user workflow, search the related unit tests and `tests/e2e` for dependencies on the old flow: button names, entry points, form states, task outcomes, and locators. Update affected tests with the implementation while preserving their business assertions.
- Prefer accessible roles and names scoped to the relevant dialog or region; use existing test IDs when a semantic locator is ambiguous. Wait for observable readiness or completion instead of fixed sleeps. Assert the meaning of incidental copy rather than its full sentence or component layout; keep accessible names and user-visible behavior covered.
- Preserve assertions for persistence, task protection, database integrity, updater behavior, and security boundaries. Reproduce suspected flakes with the affected test and inspect its failure evidence before changing it; report unresolved failures without skipping tests, adding blanket retries, or raising all timeouts.
- Before submitting a PR, run directly related unit tests with `npm test -- --run <test-file>`, `npm run typecheck`, and the necessary affected E2E with `npm run test:e2e -- <spec-file>`. Choose checks for the changed behavior; full unit and cross-platform Electron checks remain CI's responsibility.
- Node tests and Electron use different `better-sqlite3` ABIs. Use the `npm test` native-runtime wrapper and run native consumers/rebuilds sequentially within a checkout. Use `npm run native:doctor` to diagnose ABI problems.
- For source-tree Electron E2E, rebuild consumed output with `npm run build:electron` and `npx vite build`, then ensure the Electron native binary with `npm run native:ensure-electron`. Follow the selected spec's server prerequisites; use a disposable profile, verify the actual `userData` path before seeding data, and close owned processes before removing temporary files. Edit source files rather than generated output.

## Task authorities

| Task | Authority |
| --- | --- |
| GitHub issues or specs | [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) |
| Domain terminology, durable design decisions, single-context layout | [docs/agents/domain.md](docs/agents/domain.md) |
| Preload, IPC, privileged Electron contracts | [docs/agents/electron-boundaries.md](docs/agents/electron-boundaries.md) |
| SQLite, migrations, import/export, backup/restore, managed-file creation, deletion, replacement | [docs/agents/persistence.md](docs/agents/persistence.md) |
| AI providers, transmitted context, attachments, model-derived actions, privacy projection | [docs/agents/ai-contracts.md](docs/agents/ai-contracts.md) |
| UI/visual changes or review | [DESIGN.md](DESIGN.md) |
| Packaging, updater, tag, release, publication | Relevant parts of [.github/workflows/release.yml](.github/workflows/release.yml), [docs/release-checklist.md](docs/release-checklist.md), and the release scripts used by the task |
