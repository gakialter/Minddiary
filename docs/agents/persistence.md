# Persistence Contracts

Read this reference only when a task changes SQLite persistence, migrations, import/export, backup/restore, managed-file creation, deletion, or replacement, or behavior that directly depends on those contracts.

## Contract

- The Electron main process owns SQLite and managed files; renderer code uses the typed preload surface.
- Preserve user data and explicitly supported compatibility across schema, import/export, backup/restore, and managed-file changes.
- Treat migration ordering, rollback behavior, and replacement/deletion semantics as part of the changed contract when the task modifies them.

## Validation

Prove the changed persistence behavior with the nearest migration, compatibility, backup/restore, or managed-file test. Broaden only when the changed format or transition requires it.

`better-sqlite3` has different Node and Electron ABIs. If validation reports a native-module ABI mismatch, rebuild for the runtime being exercised using the repository's current package scripts and CI procedure.
