# Local Eval V1 详细实施 TODO（执行版）

更新时间：2026-03-13  
适用范围：V1（本地优先评测工具，不做平台化扩展能力）

## 0. V1 范围冻结（Scope Freeze）

- [x] 确认仓库策略：独立目录 + 独立 Git 仓库（`promptfoo-local-eval`）。
- [x] 完成 Promptfoo fork，并建立 `origin`/`upstream` 双远程。
- [x] 建立工作分支：`codex/local-eval-baseline`。
- [x] 明确 V1 必做模块：`init/eval/view`、核心 providers、核心 assertions、桌面壳最小闭环。
- [x] 明确 V1 暂不做模块：`redteam`、`codeScan/model-audit`、`MCP`、长尾 providers。
- [x] 在 README 与 TODO 同步 V1 scope 与 non-goals，防止范围漂移。

## 1. M1：Fork 基线跑通（2026-03-13 ~ 2026-03-14）

### 1.1 环境与命令基线
- [x] 在 fork 仓库安装依赖（`npm ci`）。
- [x] 跑通 CLI 基线：`promptfoo init`。
- [x] 跑通 CLI 基线：`promptfoo eval`（使用 smoke 数据）。
- [x] 跑通 CLI 基线：`promptfoo view`（本地 Web UI 可访问）。
- [x] 跑通 UI 基线：`src/app` 的 dev/build。
- [x] 记录一份 smoke 执行日志（命令、耗时、输出位置、常见报错）。（`docs/local-eval-v1-smoke-log-20260313.md`）

### 1.2 基线脚本化
- [x] 新增 `scripts/smoke-v1.sh`（一键执行 init/eval/view 的最小验证）。
- [x] 新增 `scripts/smoke-v1-assert.sh`（检查结果文件、端口、关键日志）。
- [x] 在仓库 README 增加 “V1 Baseline 验证步骤”。

### 1.3 验收标准
- [ ] 新人按 README 能在 30 分钟内跑通一次最小评测。
- [ ] 任一失败项都能在日志中定位（环境、配置、provider、assertion）。

## 2. M2：能力收敛（只保留 V1 主链路）（2026-03-14 ~ 2026-03-15）

### 2.1 CLI 命令面收敛
- [x] 在 `src/main.ts` 中保留 V1 必要命令（`init/eval/view`）并标记非 V1 命令。（新增 `PROMPTFOO_V1_MINIMAL_MODE`，默认开启）
- [ ] 对 `redteam`、`modelScan/codeScan`、`mcp` 入口先做软禁用（feature flag 或隐藏命令）。
- [ ] 对 `share/cloud` 相关功能标注默认关闭策略（本地优先）。

### 2.2 Web 路由与页面收敛
- [ ] 在 `src/app/src/App.tsx` 仅保留 V1 路由（eval/history/datasets/providers 所需路径）。
- [ ] 隐藏/移除 model-audit 与 redteam 页面导航入口。
- [ ] 兼容旧路径访问（保留必要 redirect，避免空白页）。
- [ ] 清理 V1 不需要的 UI 文案和按钮，减少认知负担。

### 2.3 Server 路由收敛
- [ ] `src/server/server.ts` 仅保留 V1 必要 API。
- [ ] 对非 V1 API 返回明确提示（Not enabled in V1），避免 silent failure。
- [ ] 验证 Web UI 主流程在收敛后无断链。

### 2.4 验收标准
- [ ] 用户从首页进入后，只看到 V1 相关能力。
- [ ] 无 redteam/model-audit/mcp 的死链、空页面、报错弹窗。
- [ ] V1 主流程（配置 -> 执行 -> 查看）零阻塞。

## 3. M3：Provider 与 Assertion 最小集（2026-03-15）

### 3.1 Provider 策略落地
- [ ] 首批官方支持 provider：`openrouter:*`。
- [ ] 首批官方支持 provider：OpenAI-compatible `http/https`。
- [ ] 保留自建 HTTP 网关接入模板（含鉴权与 base URL 示例）。
- [ ] 形成 “支持列表 / 实验性列表 / 暂不支持列表” 文档。

### 3.2 Assertion 策略落地
- [ ] 保留核心断言：`equals`、`contains`、`regex`、`llm-rubric`、`model-graded-*`。
- [ ] 保留核心指标：latency、cost、token usage。
- [ ] 对暂不纳入 V1 的断言给出替代建议（文档层）。

### 3.3 配置模板与示例
- [ ] 提供 `promptfooconfig.v1.min.yaml`（最小配置）。
- [ ] 提供 `promptfooconfig.v1.multi-model.yaml`（多模型对比配置）。
- [ ] 提供 `datasets/smoke.csv` + `datasets/demo.csv` 示例数据。

### 3.4 验收标准
- [ ] 用户无需读源码，按模板可完成多模型对比评测。
- [ ] 常见错误（API key、endpoint、模型名）有清晰报错提示。

## 4. M4：中文化（关键路径）（2026-03-15 ~ 2026-03-16）

### 4.1 i18n 基础设施
- [ ] 选定并接入 i18n 方案（保持与现有 UI 技术栈兼容）。
- [ ] 建立中英文语言包与 key 命名规范。
- [ ] 建立术语表（provider、assertion、run、dataset 等）。

### 4.2 V1 关键页面翻译
- [ ] 导航与入口页文案中文化。
- [ ] Dataset 配置和导入相关文案中文化。
- [ ] Provider 配置相关文案中文化。
- [ ] Run 执行状态、错误提示、断言结果文案中文化。
- [ ] History/结果查看页关键文案中文化。

### 4.3 验收标准
- [ ] 全关键路径无明显英文阻断（专业术语可保留英文）。
- [ ] 翻译文案与真实行为一致，无误导性表达。

## 5. M5：桌面壳最小闭环（2026-03-16 ~ 2026-03-17）

### 5.1 应用骨架
- [ ] 完善 `apps/local-eval-desktop` 工程结构（main/renderer/server runner）。
- [ ] 补全 `dev/build/package` 脚本（至少本机可运行）。
- [ ] 补全桌面端 README（安装、启动、排错）。

### 5.2 运行闭环
- [ ] 打通桌面启动后自动拉起本地 Promptfoo 服务。
- [ ] 打通“选择数据集 -> 运行 eval -> 查看结果”桌面内闭环。
- [ ] 嵌入或跳转到本地 Web UI 的稳定方案确定并落地。

### 5.3 本地数据与密钥策略
- [ ] 数据目录分层（`datasets/`、`runs/`、`exports/`、`logs/`）。
- [ ] 默认遥测关闭，隐私开关可见。
- [ ] API key 读取策略明确（环境变量 + 系统密钥存储预留）。

### 5.4 验收标准
- [ ] 非研发同学可按步骤完成一次评测并拿到结果。
- [ ] 关闭应用后再次打开，历史 run 可见。

## 6. M6：Web 交付与发布（2026-03-17 ~ 2026-03-18）

### 6.1 Web 可访问版本
- [ ] 输出静态构建产物（可部署）。
- [ ] 增加访问控制策略（Basic Auth 或网关白名单）。
- [ ] 输出部署手册（环境变量、构建命令、回滚方法）。

### 6.2 桌面打包
- [ ] 打通 macOS 打包（dmg）。
- [ ] 打通 Windows 打包（nsis）。
- [ ] 产物命名规则、版本号规则、checksum 规则确定。

### 6.3 发布材料
- [ ] 发布说明（功能范围、已知限制、升级路径）。
- [ ] 回归 checklist（安装、运行、评测、导出、日志）。
- [ ] FAQ（网络、密钥、provider 报错、端口冲突）。

### 6.4 验收标准
- [ ] 至少完成 1 次端到端预发布演练（桌面 + Web）。
- [ ] 预发布问题闭环并形成 issue 列表。

## 7. 质量与风险控制（持续执行）

### 7.1 质量门禁
- [ ] 每次改动后执行 smoke baseline（init/eval/view）。
- [ ] 每个里程碑结束前执行一次回归 checklist。
- [ ] 发布前冻结范围，不再新增非 V1 功能。

### 7.2 风险跟踪
- [ ] 记录 provider 兼容性风险（OpenRouter/兼容网关差异）。
- [ ] 记录桌面端安全风险（密钥、日志脱敏、文件权限）。
- [ ] 记录部署风险（公网访问控制、静态资源缓存）。

### 7.3 待决事项（需在实施前确认）
- [ ] 中文化范围：关键路径优先 or 全量翻译。
- [ ] Web 访问策略：Basic Auth、IP 白名单、或网关鉴权。
- [ ] 桌面依赖策略：离线内置 Promptfoo or 首次启动下载。

## 8. 我们的逐步实施顺序（执行建议）

1. 先完成 M1 基线跑通与脚本化。  
2. 再做 M2 命令/路由收敛，确保只剩 V1 主链路。  
3. 然后做 M3 provider/assertion 最小集，稳定可用性。  
4. 再推进 M4 中文化关键路径。  
5. 最后完成 M5 桌面闭环与 M6 发布交付。  
