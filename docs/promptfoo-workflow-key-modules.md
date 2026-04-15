# Promptfoo Workflow & Key Modules (Draft)

Updated: 2026-03-13
Branch: `codex/local-eval-baseline`

## 1. End-to-end workflow (init -> eval -> view)

### 1.1 `promptfoo init`
- CLI entry registers `init` in [`src/main.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/main.ts).
- Command implementation is in [`src/commands/init.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/commands/init.ts).
- Two main paths:
- `initializeProject(...)` for local scaffold.
- `--example` downloads example config/files from GitHub.

### 1.2 `promptfoo eval`
- CLI entry registers `eval` in [`src/main.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/main.ts).
- Command parsing and options are in [`src/commands/eval.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/commands/eval.ts).
- Main execution flow:
- Load/merge config via [`src/util/config/load.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/util/config/load.ts).
- Resolve providers via [`src/providers/index.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/providers/index.ts) and [`src/providers/registry.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/providers/registry.ts).
- Evaluate matrix in [`src/evaluator.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/evaluator.ts).
- Apply assertions via [`src/assertions/index.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/assertions/index.ts).
- Persist runs/results via eval models + DB layer:
- [`src/models/eval.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/models/eval.ts)
- [`src/util/database.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/util/database.ts)
- [`src/database/index.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/database/index.ts)

### 1.3 `promptfoo view`
- Command is in [`src/commands/view.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/commands/view.ts).
- It boots Express + Socket.IO in [`src/server/server.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/server/server.ts).
- Static frontend bundle comes from workspace app [`src/app/`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/app).
- Server routes expose eval/provider/config APIs (for UI CRUD and run operations).

## 2. Recommended keep scope (V1)

### 2.1 Must keep
- CLI shell:
- [`src/entrypoint.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/entrypoint.ts)
- [`src/main.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/main.ts)
- Core commands:
- [`src/commands/init.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/commands/init.ts)
- [`src/commands/eval.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/commands/eval.ts)
- [`src/commands/view.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/commands/view.ts)
- Eval engine:
- [`src/evaluator.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/evaluator.ts)
- [`src/evaluatorHelpers.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/evaluatorHelpers.ts)
- Config system:
- [`src/util/config/`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/util/config)
- Assertions:
- [`src/assertions/`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/assertions)
- Provider loading core:
- [`src/providers/index.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/providers/index.ts)
- [`src/providers/registry.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/providers/registry.ts)
- Data persistence + migrations:
- [`src/database/`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/database)
- [`src/models/`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/models)
- [`src/migrate.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/migrate.ts)
- Web UI runtime:
- [`src/server/`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/server)
- [`src/app/`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/app)

### 2.2 Provider strategy for V1
- Keep first-class support for:
- `openrouter:*`
- OpenAI-compatible via `http/https` provider
- local/custom HTTP gateway
- Optional keep:
- `openai:*` family (chat/responses/embedding)
- Cut later (V1 not required):
- long tail vendor providers (if we need to shrink dependency and maintenance cost)

### 2.3 Assertions strategy for V1
- Keep baseline:
- `equals`, `contains`, `regex`, `llm-rubric`, `model-graded-*`, latency/cost metrics
- Defer:
- niche metrics and language-specific assertion runtimes only if they create packaging burden

## 3. Candidate cut scope (after baseline is green)

### 3.1 Feature domains likely not required in V1
- Redteam stack:
- [`src/redteam/`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/redteam)
- code scan/model audit stack:
- [`src/codeScan/`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/codeScan)
- model-audit UI pages in app
- MCP server commands if not needed for desktop first release
- share/cloud auth commands if we stay local-first

### 3.2 Non-product directories
- `examples/`, `site/`, `.github/` (can be removed or split to separate docs repo later)

## 4. Practical trimming order

1. Keep runtime green with only `init/eval/view`.
2. Disable hidden entrypoints/routes (redteam/model-audit/code-scan) behind feature flags first.
3. Remove server routes and app pages not used.
4. Remove command registrations from [`src/main.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/main.ts).
5. Remove provider imports from [`src/providers/registry.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/providers/registry.ts) and shrink dependencies.
6. Re-run smoke flow: `init -> eval -> view`.

## 5. Notes

- Telemetry is already controllable by env (`PROMPTFOO_DISABLE_TELEMETRY`) in [`src/telemetry.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/telemetry.ts).
- Local data path defaults to `~/.promptfoo` via [`src/util/config/manage.ts`](/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval/src/util/config/manage.ts).
