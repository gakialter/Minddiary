# AI Contracts

Read this reference only when a task changes an AI provider, transmitted context, attachments, model-derived actions, privacy projection, or behavior that directly depends on those contracts.

## Contract

- The Electron main process owns AI networking and provider secrets.
- Treat model output as untrusted candidate data. Validate it locally before it can affect application state.
- Bound user-triggered transmission, protect secrets and local data, and preserve the intended privacy projection.
- Keep explicit user confirmation before model-proposed state changes, including persisted AI-derived actions.

## Validation

Exercise the AI contract actually changed: the relevant provider request, context projection, attachment path, response validation, or confirmation flow. Add malformed-response, redaction, retry, stale-context, or partial-failure cases only when the change can affect them.
