# Architecture

This folder documents the architecture of **git-tasks** using the [C4 Model](https://c4model.com/):

| Level | View | What it shows | File |
|---|---|---|---|
| 1 | **System Context** | git-tasks in its world: the personas and external systems it touches. | [01-context.md](01-context.md) |
| 2 | **Container** | The deployable / runnable units inside git-tasks and how they share data. | [02-container.md](02-container.md) |
| 3 | **Component** | Internal components of the two main containers (VS Code extension and CLI), plus the shared annotation engine. | [03-component.md](03-component.md) |
| 4 | **Code** | Key types and call-graphs inside the annotation engine: reconcile + three-way merge. | [04-code.md](04-code.md) |

## Reading order

Start at **Level 1** if you're new — it answers "what problem does this solve and for whom." Drop straight into **Level 3** if you're about to change code. **Level 4** is reference material for changes inside `src/taskManager.ts`.

## Conventions

- Diagrams are written in [Mermaid](https://mermaid.js.org/) so they render on GitHub and stay diffable.
- "Person" boxes (👤) are human or AI actors. "System" boxes are git-tasks-owned. "External" boxes are systems we integrate with but do not own.
- Arrows are labelled with the *purpose* of the call, not the protocol.

## Source of truth

These documents describe the codebase as it stands. When the implementation changes, update the relevant level. The annotation *schema* is canonically defined in [`src/types.ts`](../../src/types.ts) — the diagrams here reference it but do not redefine it.
