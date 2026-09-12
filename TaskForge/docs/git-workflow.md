# TaskForge — Git & Phase Workflow

## Repository as Source of Truth

GitHub holds the permanent history of TaskForge. Each completed phase corresponds to one clean commit (occasionally more, if explicitly justified) on `main`.

## Branching

For this solo learning project, working directly on `main` is acceptable and simplest — one phase, one commit, one push. If you want extra practice, you can optionally use a `phase-XX` branch and merge it, but that isn't required by this workflow.

## Standard Per-Phase Flow

1. Claude builds Phase `N`, complete with a full project ZIP snapshot: `TaskForge-Phase-N.zip`.
2. You download and extract the ZIP, replacing (or merging into) your local `TaskForge/` project folder per the exact instructions given for that phase.
3. You verify the phase runs correctly using the provided verification checklist.
4. You run the exact Git commands given, e.g.:

```bash
git status
git add .
git commit -m "feat(database): add initial database architecture"
git push origin main
```

5. You tell Claude "Start Phase N+1" when ready.

## Commit Message Rules

- Conventional Commits style: `type(scope): short description`.
- One phase = one meaningful commit describing the overall change, unless the phase genuinely contains distinct logical changes worth splitting (this will be called out explicitly when it happens).
- Exact commit messages are always provided — never "write your own message."

## What Gets Committed

- All source code, configuration, documentation, tests, and Docker/CI files.
- `.env.example` (safe placeholder values only).

## What Never Gets Committed

- Real `.env` files containing actual secrets.
- `node_modules/`.
- Build output (`dist/`, `build/`) unless a specific reason requires it.
- Any real credentials, API keys, or tokens.

These are captured in `.gitignore` starting from Phase 00.

## Initial Repository Setup (Phase 00)

```bash
cd TaskForge
git init
git add .
git commit -m "chore: initial project scaffold and architecture docs (Phase 00)"
git branch -M main
git remote add origin <your-empty-github-repo-url>
git push -u origin main
```
