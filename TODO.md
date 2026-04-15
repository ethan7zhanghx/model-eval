# Local Eval · Promptfoo 方案 TODO（2026-03-13）

> 旧版平台化路线已归档（见 `docs/archive/TODO-20260313-legacy.md`）。本文件仅覆盖“基于 Promptfoo + 本地桌面壳”的执行计划。
> V1 详细实施清单见：`docs/local-eval-v1-detailed-todo.md`

## 1. 当前方向与硬约束
- 必须复用 Promptfoo 的评测能力与 Web UI，不重新造测评框架。
- 数据、密钥、运行记录默认留在本机；遥测默认关闭。
- 支持多 Provider（OpenRouter、OpenAI-compatible、自建 HTTP 网关）。
- 同时交付：桌面端（Electron 包装 Promptfoo CLI/UI）+ 可公网访问的 Web 端。

## 2. 今日目标（2026-03-13）
1. **梳理 Promptfoo 功能与评测流程**：CLI (`init/eval/view`)、provider 体系、断言/指标、结果目录；实际跑一遍记录。
2. **挑选我们需要的核心能力**：低代码数据集配置、Provider 选择、多模型对比、Run 结果结构、断言 API；列出暂不保留项。
3. **精简仓库方案**：在 fork 中保留 CLI/Web UI/核心 provider/文档，标注可移除的 CI 集成、示例、插件。
4. **中文化与交付规划**：完成关键 UI 文案翻译方案，定义 Web 端部署方式（静态托管、安全访问）和桌面端封装流程（Electron + Promptfoo CLI + 数据目录）。

交付物：
- 一份 Promptfoo 功能&流程文档（含截图/命令）。
- “核心能力 vs 可裁剪项”表。
- 精简仓库操作清单。
- 中文化 & 桌面/ Web 发布方案说明。

### 2.1 梳理 Promptfoo 流程（文档输出）
- [x] 安装依赖并执行 `promptfoo init`，记录生成文件结构。（详见 `docs/promptfoo-flow.md`）
- [x] 使用示例数据跑 `promptfoo eval`，截取 CLI 输出、结果目录结构（`results/latest`）。（后续可补 CLI 截图）
- [x] 启动 `promptfoo view`，记录 UI 关键页面（配置、结果矩阵、断言细节）。（同上文档）
- [x] 总结 CLI ↔ UI 之间参数传递关系。（同上文档）

### 2.2 核心能力 vs 不保留项
- [x] 列出我们需要的 Promptfoo 特性（按数据集、Provider、断言、报告、导出分类）。（`docs/promptfoo-core-scope.md`）
- [x] 对每个特性标注“直接复用 / 需要二次开发 / 暂不保留”。（同上）
- [x] 收敛一份“精简模式”配置模板（只含必需字段）。（`docs/promptfoo-min-config.yaml`）

### 2.3 精简仓库方案
- [x] 浏览 Promptfoo 仓库结构，列出核心目录（CLI、UI、providers、docs）。（`docs/promptfoo-fork-plan.md`）
- [x] 列出可移除/暂缓的目录或脚本（CI、插件、云集成、示例项目）。（同上）
- [x] 输出“保留 vs 移除”对照表，并写改动顺序（先删除 CI 配置，再调整 package scripts 等）。（同上）

### 2.4 中文化 + 交付规划
- [x] 摘出 UI 中必须翻译的文案列表（导航、按钮、表单、提示）。（`docs/localization-release-plan.md`）
- [x] 选定 i18n 技术方案（例如 `react-intl`），列出改动步骤。（同上）
- [x] Web 部署方案：托管位置、防护策略（Basic Auth/IP allowlist）、构建命令。（同上）
- [x] 桌面封装方案：Electron 主进程流程、Promptfoo CLI 调用方式、数据目录/密钥策略。（同上）
- [x] 汇总成“发布 checklist”（桌面安装包、Web 构建包、说明文档）。（同上）

## 3. 本周剩余交付里程碑

### P0（今天）：调研 + 规划
- [x] 完成第 2 节四项输出，并得到确认。
- [x] 确定 fork & 新仓库结构（独立目录 + 独立 Git 仓库；已创建 `promptfoo-local-eval/` 与 fork）。

### P1（2026-03-14 ~ 2026-03-15）：Promptfoo fork 基线
- [ ] Fork Promptfoo，跑通 `promptfoo init/eval/view` + UI dev/build。
- [ ] 移除不需要的 CI/集成；保留核心命令与 UI。
- [ ] 引入 i18n 方案，完成关键模块中文翻译（导航、数据集、Provider、Run/断言、看板）。
- [ ] 撰写中文 README/使用指南。

### P2（2026-03-15 ~ 2026-03-16）：桌面壳最小可运行
- [ ] 新建桌面仓库（Electron + Promptfoo CLI runner）。
- [ ] 实现“启动 -> 选择数据集 -> 运行 Promptfoo -> 内嵌 Web UI”闭环。
- [ ] 配置本地数据目录与密钥读取（Keychain/Credential Manager）。

### P3（2026-03-17 ~ 2026-03-18）：Web 端部署 + Release 脚本
- [ ] 构建可公网访问的静态站（Promptfoo UI build + 访问控制）。
- [ ] Electron 打包脚本（macOS dmg、Windows nsis）。
- [ ] Release 说明与回归 checklist。

## 4. 待决事项 / 风险
- Promptfoo UI 中文化范围是否全量翻译还是关键路径翻译？
- Web 端托管是否需要登录/网关？（影响部署方式）
- 桌面壳是否要离线内置 Promptfoo 依赖，或允许首次启动自动安装？

## 5. 参考资料
- Promptfoo 官方文档：https://www.promptfoo.dev/docs
- Legacy 路线：`docs/archive/TODO-20260313-legacy.md`
