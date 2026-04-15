# Promptfoo Fork 精简方案（2026-03-13）

## 1. 结构保留
- `packages/promptfoo`（CLI 核心）
- `packages/ui` 或 `src/app`（React Web Viewer 与 eval setup）
- `packages/provider-*`（官方 provider 适配层）
- `docs/`（保留 README、Quickstart、API 章节，用于中文化）
- `examples/getting-started`（保留一个最小示例供测试）

## 2. 可移除 / 暂缓
- `.github/workflows/*`：CI/CD、Checks、Release pipeline（后续按需恢复）
- `examples/*` 中与我们无关的扩展示例（GitHub Checks、Slack 通知等）
- `packages/*` 下与 Slack/Teams/CI 集成相关的子包
- `scripts/` 中针对 Promptfoo Cloud/Telemetry 的脚本
- `docs/site` 中非必要页面（社区、招聘等）

## 3. 精简步骤
1. Fork Promptfoo 到 org。
2. 创建 `local-eval` branch 专注本地化需求。
3. 删除/禁用 `.github/workflows`，更新 `package.json` scripts（去掉 `deploy-docs`、`publish-cloud` 等）。
4. 保留 `promptfoo eval setup` 所需的前端构建脚本，确保 `npm run dev:app`、`npm run build:app` 可用。
5. 增加 `docs/LOCALIZATION.md` 与中文 README。
6. 设定 `packages/*` 的 `sideEffects` 与构建输出，方便 Electron 壳嵌入。

## 4. 同步策略
- 每周从 upstream `main` rebase 一次，保持核心能力最新。
- 精简改动集中在独立 commit，便于未来 rebase / PR。
- 桌面壳仓库将用 git submodule 指向 fork 指定 commit。
