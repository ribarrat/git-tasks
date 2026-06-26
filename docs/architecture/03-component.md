# Level 3 — Component

Zooming into the **VS Code Extension**, the **CLI**, and the **Annotation Engine** containers from [Level 2](02-container.md).

## VS Code Extension components

```mermaid
C4Component
    title Component — VS Code Extension

    Person(dev, "Developer", "")
    System_Ext(vscode, "VS Code API", "")

    Container_Boundary(ext, "VS Code Extension") {
        Component(activate, "extension.ts", "Activation + command registry", "Wires providers; registers commands; manages lineHasAnnotation context key.")
        Component(sidebar, "SidebarProvider", "TreeDataProvider<Node>", "Groups tasks by file; applies filters; contextValue differs for resolved items.")
        Component(hover, "AnnotationHoverProvider", "HoverProvider", "Markdown popup: colored fields, drift warning, Edit / Resolve / Delete links.")
        Component(gutter, "GutterProvider", "TextEditorDecorationType", "Maps entry.type to SVG icon; applies gutter decorations.")
        Component(watcher, "AnnotationsWatcher", "FileSystemWatcher", "Watches .git-tasks/**/*.json; fires onAnnotationsChanged.")
    }

    Container(engine, "Annotation Engine", "TS module", "")

    Rel(dev, vscode, "")
    Rel(vscode, activate, "activate")
    Rel(activate, sidebar, "registers")
    Rel(activate, hover, "registers")
    Rel(activate, gutter, "apply / clear")
    Rel(activate, watcher, "subscribes")
    Rel(sidebar, engine, "list & reconcile")
    Rel(hover, engine, "load, drift check")
    Rel(gutter, engine, "reads entries")
    Rel(watcher, engine, "triggers refresh")
    Rel(activate, engine, "mutates entries")
```

### Notes
- `extension.ts` is the only component allowed to call mutating engine functions; providers are read-only.
- The `gitTasks.lineHasAnnotation` context key (set on selection change) is what hides **Add Task** in the editor right-click menu when the cursor sits on a line that already has a task.
- The watcher is the *only* push channel into the UI — every other refresh is pulled by VS Code lifecycle events.

## CLI components

```mermaid
C4Component
    title Component — CLI

    Person(user, "Developer / CI / agent", "")

    Container_Boundary(cli, "CLI (out/cli/index.js)") {
        Component(root, "index.ts", "Commander root", "Bootstraps; resolves repo root; mounts all subcommands.")
        Component(util, "util.ts", "Formatting helpers", "Shared formatting and flag parsing.")

        Component(add, "commands/add.ts", "add", "")
        Component(list, "commands/list.ts", "list", "")
        Component(show, "commands/show.ts", "show", "")
        Component(update, "commands/update.ts", "update", "")
        Component(remove, "commands/remove.ts", "remove", "")
        Component(reconcile, "commands/reconcile.ts", "reconcile", "")
        Component(check, "commands/check.ts", "check", "CI gate: reconcile + open-severity rules.")
        Component(diff, "commands/diff.ts", "diff", "Tasks on changed files; GitHub Checks output.")
        Component(stats, "commands/stats.ts", "stats", "Density / SLA report.")
        Component(installHooks, "commands/installHooks.ts", "install-hooks", "")
        Component(installMD, "commands/installMergeDriver.ts", "install-merge-driver", "")
        Component(driverEntry, "commands/mergeDriver.ts", "merge-driver", "Invoked by git; delegates to mergeAnnotationFiles.")
    }

    Container(engine, "Annotation Engine", "TS module", "")

    Rel(user, root, "git-tasks <cmd>")

    Rel(add, engine, "addEntry")
    Rel(list, engine, "listAllEntries")
    Rel(show, engine, "findEntryById")
    Rel(update, engine, "updateEntry")
    Rel(remove, engine, "removeEntry")
    Rel(reconcile, engine, "reconcileAll")
    Rel(check, engine, "reconcileAll")
    Rel(diff, engine, "listAllEntries")
    Rel(stats, engine, "listAllEntries")
    Rel(driverEntry, engine, "mergeAnnotationFiles")
    Rel(list, util, "")
    Rel(show, util, "")
    Rel(update, util, "")

    UpdateLayoutConfig($c4ShapeInRow="4", $c4BoundaryInRow="1")
```

### Notes
- Every subcommand is a thin orchestrator. No business logic lives in `cli/commands/*` — they parse flags, call the engine, format output. `index.ts` mounts all of them via Commander; those arrows are omitted from the diagram to reduce clutter.
- `invocation.ts` (not shown) handles argv normalisation for node vs symlinked-bin invocations.
- `mergeDriver.ts` is a CLI subcommand only in the technical sense: git invokes it as `git-tasks merge-driver %O %A %B`. It's intentionally undocumented in `--help`.
- `check` and `diff` are the components that integrate with GitHub Actions; their exit codes and `--format json` / `--github-annotations` output are part of the public contract.

## Annotation Engine components

```mermaid
C4Component
    title Component — Annotation Engine (src/)

    Container_Boundary(engine, "Annotation Engine") {
        Component(types, "types.ts", "Schema", "AnnotationEntry, AnnotationFile, EntryType / Status / Priority / Severity unions, SCHEMA_VERSION.")
        Component(crud, "CRUD layer", "in taskManager.ts", "createEntry, addEntry, findEntryById, updateEntry, removeEntry, listAllEntries.")
        Component(io, "I / O layer", "in taskManager.ts", "annotationFilePathFor, loadAnnotationFile, saveAnnotationFile, listAllAnnotationFiles, deleteAnnotationFileIfEmpty.")
        Component(merge, "Three-way merge", "in taskManager.ts", "mergeEntry (field-wise: last updatedAt wins; tags unioned), mergeAnnotationFiles (union by id, detect structural conflicts).")
        Component(drift, "Drift detection", "in taskManager.ts", "extractLineContent, isDrifted, findSnapshotIn, softMatchSnapshot — exact + line-LCS soft match.")
        Component(reconcile, "Reconcile", "in taskManager.ts", "reconcileEntry → {ok|moved|soft-match|stale|orphan}; reconcileAll walks every file and optionally applies moves.")
        Component(git, "gitHelper.ts", "git CLI wrapper", "findRepoRoot, isGitRepo, getCurrentCommitSHA, getUserName, getUserEmail, isCurrentUser — shells out to git with pinned env.")
    }

    Component_Ext(cp, "node:child_process", "")
    Component_Ext(fs, "node:fs", "")

    Rel(crud, io, "")
    Rel(crud, types, "")
    Rel(crud, drift, "snapshot on create")
    Rel(reconcile, io, "")
    Rel(reconcile, drift, "findSnapshotIn / softMatchSnapshot")
    Rel(merge, types, "")
    Rel(io, fs, "readFileSync / writeFileSync / readdirSync")
    Rel(git, cp, "spawnSync('git', ...)")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

### Notes
- The engine has no VS Code or Commander imports — it's plain TS. That's what lets the same module power the editor, the CLI, and the merge driver.
- Boundaries between "I/O", "CRUD", "drift", "reconcile", "merge" are conceptual — they're all in `src/taskManager.ts` today, grouped here so the diagram stays readable. If the file grows further, splitting along these lines is the natural cut.
- `gitHelper.ts` is the only place that shells out. Tests pin `GIT_CONFIG_GLOBAL`/`SYSTEM` to `/dev/null` so the helper can never read the developer's global config (see [README.md:96-100](../../README.md)).

Next: [Level 4 — Code](04-code.md).
