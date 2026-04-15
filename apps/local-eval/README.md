# Local Eval (Promptfoo + Desktop Shell)

This sub-app is the local-first evaluation track.

## Product constraints (must meet)

1. Dataset and run data stay local by default. No automatic cloud sync.
2. Privacy by default. Telemetry is off by default.
3. Multi-provider support. OpenRouter and OpenAI-compatible endpoints are both first-class.
4. Provider is pluggable. Team gateway/proxy must be supported.

## This week scope (MVP)

- Import dataset locally and run multi-model eval with Promptfoo.
- Keep run snapshots and export JSON locally.
- Ship a desktop shell (macOS + Windows) that starts local service automatically.

## Out of scope (this week)

- Multi-tenant workspace, role permissions, cloud task queue.
- Hosted key vault and org billing center.
- Cloud dataset asset management.

## Architecture (v0.1)

- `src/main`: Electron process (desktop shell, process orchestration, keychain bridge).
- `src/server`: Local API and Promptfoo runner wrapper.
- `src/web`: Local web workspace UI.
- `data`: Local run snapshots and export files.
- `evals`: Promptfoo config templates and smoke datasets.

## Local data directories

- macOS: `~/Library/Application Support/LocalEval/`
- Windows: `%APPDATA%\\LocalEval\\`
- Linux (for dev): `~/.local/share/local-eval/`

Planned subfolders:

- `datasets/`
- `runs/`
- `exports/`
- `logs/` (sensitive fields must be masked)

## Command contract

- `npm run dev` - start local dev server for the local-eval workspace.
- `npm run build:web` - build static web assets.
- `npm run package` - package desktop app artifact (placeholder for now).
- `npm run make:release` - build release bundle and checklist output (placeholder for now).

## Repo strategy

Use a dedicated repository for delivery speed and clear ownership. For Promptfoo integration:

- Keep product code in this repository.
- Track Promptfoo as upstream dependency/fork source.
- Keep customization inside thin wrappers (`src/server/promptfoo-runner.*`) to reduce merge pain.

If we need deep Promptfoo core modifications later, fork and maintain a minimal patch set instead of mixing product code into Promptfoo internals.
