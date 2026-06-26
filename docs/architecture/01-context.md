# Level 1 — System Context

The big picture: who uses git-tasks, what it does for them, and which external systems it touches.

```mermaid
C4Context
    title System Context — git-tasks

    Person(dev, "Developer", "Creates and resolves line-pinned tasks instead of losing context in chat.")
    Person(reviewer, "Reviewer", "Reviews PRs; reads tasks surfaced inline on the diff.")
    Person(oncall, "On-call engineer", "Investigates incidents; looks up tasks at the failing line.")
    Person_Ext(agent, "AI coding agent", "Picks up assigned tasks, makes changes, closes the loop.")

    System(gittasks, "git-tasks", "Line-pinned tasks stored as JSON inside the Git repo.")

    System_Ext(git, "Git repository", "Tasks live under .git-tasks/, committed alongside source.")
    System_Ext(vscode, "VS Code", "Hosts the extension: gutter icons, sidebar, hover popups.")
    System_Ext(ci, "GitHub Actions / CI", "Runs check / diff / stats on every PR and merge.")
    System_Ext(monitors, "Error monitors", "Sentry / Datadog — reads .git-tasks/ at the deployed SHA.")

    Rel(dev, gittasks, "creates & resolves")
    Rel(reviewer, gittasks, "reads on PRs")
    Rel(oncall, gittasks, "looks up by line")
    Rel(agent, gittasks, "lists work, resolves")

    Rel(gittasks, git, "reads & writes JSON")
    Rel(gittasks, vscode, "extension UI")
    Rel(gittasks, ci, "check / diff / stats")
    Rel_Back(monitors, gittasks, "reads task files")
```

## Why this shape

- **One system, many surfaces.** The same `.git-tasks/*.json` files feed the editor, the terminal, CI, and external monitors. There is no server, no API, no auth — the repo is the queue and the database.
- **Four audiences with the same data.** Humans and agents both create and resolve tasks; reviewers and on-call engineers mostly read; CI both reads (gate, report) and writes (auto-resolve via merge commit).
- **External systems are pull-based.** git-tasks doesn't push to GitHub or to Sentry; integrations read the JSON at a known commit. This is what makes it deployable as a thin reader anywhere.

## What's intentionally out of scope

- **No backend service.** There is no git-tasks server to host, scale, or secure.
- **No identity system.** Tasks carry `author` / `assignee` strings; matching against the active user happens locally via `git config user.email` and `user.name` (see [`src/gitHelper.ts`](../../src/gitHelper.ts)).
- **No notifications.** Slack / email integrations are templates teams add on top — the data is in the repo, the wiring is theirs.

Next: [Level 2 — Container](02-container.md).
