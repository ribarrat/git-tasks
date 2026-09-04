# @ribarrat/git-tasks

CLI for [git-tasks](https://github.com/ribarrat/git-tasks) — annotate lines of code with tasks, comments, and issues stored directly in your Git repo (no external tracker, works offline, survives merges).

This package ships only the CLI. For the VS Code extension (gutter markers, sidebar panel, hover popups), install "Git Tasks" from the VS Code Marketplace instead.

## Install

```sh
npm install -g @ribarrat/git-tasks
```

The command is `git-tasks` (not scoped) once installed.

## Usage

```sh
# Add a task
git-tasks add src/index.ts 42 --type task --text "Handle empty input"

# List everything
git-tasks list

# Show one annotation in full
git-tasks show <id>

# Update status
git-tasks update <id> --status resolved

# CI gate — fail build on open critical annotations in changed files
git-tasks check --fail-on-open-severity critical --base origin/main
```

Full CLI reference, storage format, drift detection, git hooks, and CI integration docs: see the [main README](https://github.com/ribarrat/git-tasks#readme).
