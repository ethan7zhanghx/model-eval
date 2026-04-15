# Promptfoo 流程梳理（2026-03-13）

## 1. CLI 核心命令

| 命令 | 作用 | 备注 |
| --- | --- | --- |
| `promptfoo init [dir]` | 创建示例目录与 `promptfooconfig.yaml` | 可选择官方示例 `--example getting-started`，自动生成 prompts/providers/tests 示例 |
| `promptfoo eval` | 按配置评测所有 prompt × provider × test case | 读取当前目录配置，也可用 `--config` 指定其它文件 |
| `promptfoo view` | 启动 Web UI，浏览和筛选评测结果 | Web viewer 支持筛选/搜索/显示模式/图表等 |
| `promptfoo eval setup` | 使用浏览器向导配置首次评测 | 适用于低代码团队，同步写入配置文件 |
| 其他指令 | `share`, `auth`, `cache`, `config`, `generate`, `list`, `logs`, `mcp` | 供后续云分享、缓存管理、生成数据等扩展使用 |

## 2. 标准评测流程（示例）

1. **初始化项目**
   ```bash
   npx promptfoo@latest init --example getting-started
   cd getting-started
   ```
   结果：生成 `promptfooconfig.yaml`、示例 README、tests 等文件。

2. **设置凭证**
   ```bash
   export OPENAI_API_KEY=sk-***
   ```
   也可在 `providers` 中配置 OpenRouter 或其它兼容接口。

3. **运行评测**
   ```bash
   npx promptfoo@latest eval
   ```
   CLI 输出会展示运行状态、断言通过/失败统计。

4. **打开 Web UI**
   ```bash
   npx promptfoo@latest view
   ```
   默认在本地服务器（如 `http://127.0.0.1:15500`）打开，支持：
   - Eval selector（切换不同评测）
   - Display mode（全部/失败/差异等）
   - Filters（按指标、metadata 过滤）
   - Table settings（列显示、截断、渲染模式、推理详情）
   - Charts（Pass rate、Score distribution、Scatter plot）

5. **可选：Web UI 向导**
   ```bash
   npx promptfoo@latest eval setup
   ```
   通过浏览器配置 prompts/providers/tests，适合低代码团队直接上手。

## 3. CLI ↔ UI 参数映射

| CLI 配置项 | Web UI 来源 | 说明 |
| --- | --- | --- |
| `prompts` / `providers` / `tests` | `promptfooconfig.yaml` 或 UI 向导保存的配置 | UI 读取最新配置渲染列与断言 |
| `assert` 配置 | CLI eval 期间执行，UI 展示通过/失败与分布 | UI 可按断言类型过滤、查看详情 |
| `sharing` 设置 | CLI `promptfoo share` 或 config `sharing.*` | UI 顶部的 Share 按钮读取 shareable URL/自托管设置 |
| `output` / `results` | CLI 运行生成的结果目录 | UI 通过 eval selector 读取对应 evalId 的数据 |

## 4. 本地结果与后续操作

- 评测完成后，结果写入 Promptfoo 默认的本地数据目录（可通过配置 `outputPath` 或 `PROMPTFOO_CONFIG_DIR` 调整）。
- 可使用 `promptfoo share` 把当前 eval 上传至 promptfoo.app 或自托管 endpoint，供团队远程查看。
- GitHub Action、MCP Server 等高级能力暂不在本周范围内，但保留接口。

> 注：完整交互方式与 UI 功能详见官方文档，后续翻译与定制将在 Promptfoo fork 中实现。
