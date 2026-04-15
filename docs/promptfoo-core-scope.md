# Promptfoo 功能取舍（2026-03-13）

| 功能 | 复用策略 | 说明 |
| --- | --- | --- |
| Prompt & Provider 配置（YAML + UI） | 直接复用 | 使用 `promptfooconfig.yaml` + `eval setup` UI 让同事低代码配置，多 Provider 支持来自官方实现 |
| Provider 生态（OpenRouter、OpenAI、LiteLLM、自定义 HTTP） | 直接复用 | 只需提供默认模板和中文提示，无需改底层实现 |
| 断言与指标（LLM judge、Regex、JSON Schema、自定函数） | 直接复用 | 官方已支持；我们仅需提供中文文案和推荐模板 |
| 评测矩阵 Web UI（Result viewer、Charts、Filters） | 直接复用 + 翻译 | UI 功能足够，核心工作是翻译和适配桌面壳嵌入 |
| CLI share / promptfoo.app | 暂不保留 | 数据保密优先，不启用云分享，可保留自托管选项作为后续增强 |
| GitHub Actions / Checks 集成 | 暂不保留 | 当前目标是本地工具；CI 集成后续再加 |
| Slack / Teams / 其他通知插件 | 暂不保留 | 与本地桌面场景无关，先移除依赖 |
| MCP Server / Agent 集成 | 暂缓 | 没有直接交付价值，可在后续版本恢复 |
| Examples、Playground、Docs 网站 | 精简保留 | 留必要示例和 README 中文版，其余示例可移到单独分支 |
| Telemetry / Usage reporting | 关闭 | 默认关闭并提供 UI 开关说明 |

> 交付产物：在 fork README 中列出“当前支持/未启用/待定”以便团队同步。
