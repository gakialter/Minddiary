# Electron Boundaries

Read this reference only when a task changes preload, IPC, privileged capability ownership, or behavior that directly depends on those contracts.

## Contract

- The Electron main process owns privileged capabilities. The renderer reaches them only through a narrow, typed preload API.
- Keep context isolation and sandboxing intact. Validate IPC payloads at runtime and expose only the capability the renderer needs.
- Preserve the existing navigation, permission, external-link, local-protocol, and filesystem-containment guarantees when the changed contract reaches them.
- The browser fallback is intentionally localStorage-backed. Keep shared behavior aligned where supported; privileged features report unsupported instead of bypassing Electron controls.

## Validation

Exercise the changed renderer-to-main behavior at its nearest useful seam. Add boundary-specific checks only for guarantees the change can affect; passing through Electron code does not make every Electron security check relevant.
