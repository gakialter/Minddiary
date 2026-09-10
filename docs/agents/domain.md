# Domain Docs

How the engineering skills consume MindDiary's stable domain documentation.

## When terminology or a durable decision is relevant

- Locate the relevant term or heading in root `CONTEXT.md`, when it exists, and read the matching passage.
- Find ADRs under `docs/adr/` for the decision being changed or relied upon; read those ADRs.

Do not load the glossary or ADR collection before unrelated edits.

Proceed silently when either location is absent. `/domain-modeling`, reached by workflows such as `/grill-with-docs`, creates domain material lazily when terminology or a durable decision is actually resolved.

## Layout

MindDiary is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

`CONTEXT.md` is a glossary of stable domain vocabulary. Keep implementation notes, sprint state, review findings, and handoffs elsewhere. ADRs record only decisions that are hard to reverse, surprising without context, and the result of a real trade-off.

## Use the domain vocabulary

When an issue, test, hypothesis, or implementation names a concept defined in `CONTEXT.md`, use its canonical term. If a needed concept is absent, reconsider whether the codebase already has a name before proposing a glossary addition through `/domain-modeling`.

Surface a conflict with an applicable ADR instead of silently overriding it.
