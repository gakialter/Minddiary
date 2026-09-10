# Issue tracker: GitHub

Issues and specs for this repository live in GitHub Issues. Use an authenticated GitHub interface available in the current environment. The `gh` CLI is appropriate for local repository workflows when available; provided GitHub connectors/APIs are also valid.

Root `AGENTS.md` is authoritative for external mutation authorization. Command examples do not authorize writes.

## Local CLI examples

Confirm the repository using `git remote -v`; `gh` normally infers it when run inside a clone.

- **List issues:** `gh issue list --state open`.
- **Read an issue:** `gh issue view <number> --comments`.
- **Create an issue when authorized:** `gh issue create --title "..." --body-file <file>`.
- **Comment when authorized:** `gh issue comment <number> --body-file <file>`.
- **Read a PR:** `gh pr view <number> --comments` and `gh pr diff <number>`.

For multiline bodies, use a text file with actual newlines and pass it with `--body-file`.

GitHub Issues and PRs share a number space. Resolve whether a referenced number identifies an issue or a PR before acting.
