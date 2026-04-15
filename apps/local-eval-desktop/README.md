# Local Eval Desktop (Promptfoo 基线)

独立目录用于基于 Promptfoo 的本地评测与桌面封装实验。目标：
1. 复用 Promptfoo CLI + Web UI，快速验证多 Provider 评测流程。
2. 为后续 Electron 壳、中文化、发布流程提供最小可运行样板。

当前目录结构：
```
apps/local-eval-desktop/
├── README.md
├── package.json
├── promptfooconfig.yaml
├── datasets/
│   └── smoke.csv
├── scripts/
│   └── run-eval.mjs
├── results/        # promptfoo eval 输出（自动创建）
└── src/
    ├── main/      # Electron 主进程（待实现）
    └── renderer/  # 桌面 UI（待实现）
```

## 快速开始（CLI 验证）
1. 安装依赖：`npm install`（仅安装脚本依赖，Promptfoo 使用 npx 调用）。
2. 设置环境变量：
   ```bash
   export OPENROUTER_API_KEY=sk-...
   export OPENAI_API_KEY=sk-...    # 如需 OpenAI 兼容端点
   export OPENAI_COMPAT_BASE_URL=https://api.openai.com/v1
   ```
3. 运行最小评测：
   ```bash
   npm run eval
   ```
4. 查看结果：
   ```bash
   npx promptfoo view --config promptfooconfig.yaml
   ```

## 里程碑衔接
- [ ] 接入 electron 主进程脚手架。
- [ ] renderer 中内嵌 Promptfoo Web UI build。
- [ ] scripts/make-release：打包 macOS/Windows。
- [ ] 中文化资源与 i18n 架构合并。
