# OpenRouter 多模型多轮 Case 对比台

一个前后端一体的小工具，目标是让你在相同测试场景下，对多个模型跑完整多轮流程并做矩阵对比。

## 你提出的关键点

- 模型列表来自 OpenRouter 官方模型 API（`/api/v1/models`）
- 模型通过下拉选择，不再是分行文本输入
- `temperature` 默认值为 `0`
- 采用大表格：每列一个模型，每行一个轮次 Prompt
- 支持导入 `.md/.txt` 生成多轮 Prompt
- 点击一次执行，所有模型跑完整个轮次流程
- System Prompt 作为全局上下文，贯穿所有轮次
- API Key 按浏览器本地缓存（`localStorage`）记住
- 配置历史持久化到服务端文件（部署后仍可用）
- 展示模型定价（输入/输出 `$ / 1M tokens`）并预估本次总花费

## 快速启动

```bash
cd /Users/zhanghaoxin/Desktop/Baidu/BYOK
node server.js
```

打开：`http://localhost:8080`

## 使用流程

1. 填入 OpenRouter API Key。
2. 可选勾选“记住 API Key（浏览器本地缓存）”。
3. 刷新并选择模型列。
4. 在轮次表里填写每轮 Prompt（可增删轮次），或导入 `.md/.txt`。
5. 点击“执行完整流程”。
6. 查看每个单元格返回内容、耗时和 token。
7. 可导出 JSON 记录。
8. 可保存配置历史；同一个“历史空间 ID”下可反复载入。
9. 可调整“输出 Token 估算系数”，实时查看费用估算。

## 说明

- 官方模型列表拉取失败时，会优先使用浏览器缓存；无缓存时回退内置模型。
- 历史记录默认写入 `data/config-history.json`，由 `server.js` 提供 `/api/config-history` 接口。
- `localStorage` 仅作兜底缓存，不是主存储。
- 部署到云服务器时，请确保 `data/` 目录挂载持久化存储，否则重启会丢历史。
- 当前费用估算逻辑：输入 token 按对话历史累积计算；输出 token 采用“输入 token × 输出系数（每轮至少 24）”估算。
