# 模型评测平台 · Model Eval

一个面向团队的多模型评测工具，支持批量数据集测试与主观多轮对话测试，内置三种评分机制和数据看板。

## 功能概览

### 多模型并行对比
- 每个模型列独立配置接口来源（OpenRouter 或自定义）、API Key、模型 ID
- 同一批测试用例同时发给所有模型，结果横向对比展示
- 全局 System Prompt 所有模型共用，保证对比公平

### 两种测试模式
- **批量数据集模式**：导入 CSV / JSON / XLSX，列映射后批量跑，适合有标准数据集的评测
- **主观多轮对话模式**：手动填写或导入 md/txt，支持多轮上下文，适合主观体验测试

### 三种评分机制
- **人工打分**：每条回答下方 1-5 星评分，实时汇总各模型平均分
- **精确匹配（Exact Match）**：与参考答案对比，自动标注通过/不通过
- **LLM-as-Judge**：调用 Judge 模型对回答打分（1-5分）并给出评分理由，Prompt 模板可自定义

### 数据看板
- 各模型评分排名（人工均分、Judge 均分、精确匹配率）
- 性能指标对比（平均延迟、TTFT、TPS、Token 用量）
- 历史运行记录管理

### 其他
- 配置历史：保存/载入模型列 + Prompt + 参数，支持服务端持久化
- 成本预估：基于 OpenRouter 定价自动估算本次执行花费
- 导出 JSON：一键导出完整测试结果

## 快速开始

要求：Node.js 18+

```bash
npm install
node server.js
```

打开 `http://127.0.0.1:8080`

## 使用流程

1. 在模型列配置区添加模型列，每列填写接口来源、API Key、模型 ID
2. 填写 System Prompt 和 Temperature（全局生效）
3. 导入数据集（CSV/JSON/XLSX）或手动填写测试用例
4. 点击「▶ 执行」，等待所有模型返回结果
5. 在评分配置区选择评分方式（精确匹配 / LLM Judge / 人工打分）
6. 查看数据看板了解各模型整体表现

## 项目结构

```
├── index.html        # 主评测页面
├── dashboard.html    # 数据看板
├── app.js            # 前端逻辑
├── styles.css        # 样式
├── server.js         # Node.js 服务（静态文件 + API）
├── data/             # 本地数据存储（自动创建）
│   ├── config-history.json
│   └── eval-results.json
└── zhumengdao/       # 筑梦岛子应用
```

## API 接口

| 路径 | 说明 |
|------|------|
| `GET/PUT/DELETE /api/config-history` | 配置历史管理 |
| `GET/POST/DELETE /api/eval-results` | 评测结果持久化 |
| `POST /api/llm-proxy` | LLM 请求代理 |

## 注意事项

- 费用估算为近似值，仅对 OpenRouter 模型有效
- API Key 仅在浏览器本地存储，不会上传服务端
- 数据默认存储在本地 `data/` 目录，重启服务不丢失
