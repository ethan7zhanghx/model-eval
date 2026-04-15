# Local Eval V1 Smoke 执行日志（2026-03-13）

执行仓库：`/Users/zhanghaoxin/Desktop/Baidu/Model-Eval/promptfoo-local-eval`  
执行分支：`codex/local-eval-baseline`

## 1. 环境信息

- Node.js: `v24.10.0`
- npm: `11.6.0`
- 关键环境变量：
- `PROMPTFOO_CONFIG_DIR=/tmp/promptfoo-config`（沙箱环境下避免写入 `~/.promptfoo`）
- `PROMPTFOO_DISABLE_UPDATE=true`
- `PROMPTFOO_DISABLE_TELEMETRY=true`

## 2. 执行记录

### 2.1 依赖安装

- 命令：`npm ci --registry=https://registry.npmjs.org`
- 结果：成功
- 耗时：约 `1m19s`

### 2.2 CLI 基线

- `init`
- 命令：`node dist/src/entrypoint.js init tmp/promptfoo-v1-smoke-<timestamp> --no-interactive`
- 结果：成功生成 `promptfooconfig.yaml` 与 `README.md`

- `eval`
- 命令：`node dist/src/entrypoint.js eval -c test/smoke/fixtures/configs/basic.yaml -o /tmp/promptfoo-v1-eval.json --no-progress-bar --table`
- 结果：`1 passed, 0 failed, 0 errors (100%)`

- `view`
- 命令：`node dist/src/entrypoint.js view -p 15501 -n`
- 健康检查：`curl http://127.0.0.1:15501/health`
- 返回：`{"status":"OK","version":"0.121.2"}`
- 结果：成功启动并正常关闭

### 2.3 UI 基线

- build
- 命令：`npm run build:app`
- 结果：成功
- 产物：`dist/src/app/`（包含 `index.html` 与 assets）
- 耗时：约 `1m42s`

- dev（启动验证）
- 命令：`npm run dev:app`
- 结果：Vite 启动成功（日志显示 `ready`）
- 备注：当前执行环境存在会话隔离，外部会话 `curl` 可能无法连到同一 dev 进程端口；不影响构建产物与 CLI 基线结论。

## 3. 脚本化产物

- 新增：`scripts/smoke-v1.sh`
- 新增：`scripts/smoke-v1-assert.sh`
- README 增加：V1 Baseline 验证步骤

## 4. 脚本验证结果

- `PROMPTFOO_SMOKE_SKIP_VIEW=1 ./scripts/smoke-v1.sh`：通过
- `./scripts/smoke-v1.sh`（含 view 健康检查）：通过

## 5. 备注（执行环境相关）

- 本次在受限沙箱中执行，`tsx` IPC pipe 被限制；因此验证路径采用 `node dist/src/entrypoint.js`。
- 若在常规本地开发环境执行，`npm run build` + `./scripts/smoke-v1.sh` 即可完整复现。
