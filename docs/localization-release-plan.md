# 中文化与发布方案（2026-03-13）

## 1. UI 中文化
- **范围**：导航、数据集/Provider 表单、断言结果、矩阵列标题、Charts 标签、错误提示。
- **技术**：在 Promptfoo UI（React）中引入 `react-intl`，建立 `en-US` / `zh-CN` 语言包；默认 `zh-CN`，允许切换。
- **步骤**：
  1. 创建 `i18n/strings.json`（含命名空间）。
  2. 扫描现有组件提取硬编码英文，替换为 `<FormattedMessage>`。
  3. 提供 `src/locales/zh-CN.json` 翻译，交叉校对术语（数据集=数据集、Provider=模型来源、Assertion=断言）。
  4. 在 `promptfoo eval setup` UI 中同步应用翻译。

## 2. Web 端部署
- **构建**：使用 Promptfoo UI build 产物（`npm run build:app`）+ 静态结果浏览页面。
- **托管**：优先选择可控的静态站（如 Cloudflare Pages、Vercel 私有项目、S3+CloudFront）。
- **访问控制**：
  - 强制 Basic Auth / SSO 网关。
  - 或通过 VPN/Zero-Trust（Cloudflare Access）限制访问。
- **数据**：Web 端仅用于查看结果，上传的 eval 数据需脱敏后再发布；提供“本地-only”模式。

## 3. 桌面封装
- **框架**：Electron 28+，主进程负责：
  - 启动本地 Promptfoo CLI（via child_process）。
  - 管理数据目录：`~/Library/Application Support/LocalEval`、`%APPDATA%\LocalEval`。
  - 通过 `electron-store` 或原生 Keychain/DPAPI 管理 API Key。
- **Renderer**：嵌入 Promptfoo Web UI build 产物；通过自定义 preload 向页面注入本地路径/配置。
- **流程**：
  1. 用户选择/导入数据集（渲染器 UI）。
  2. Electron 调 Promptfoo CLI 执行评测，监听 stdout/stderr。
  3. Run 完成后刷新内嵌 UI（直接指向本地结果目录）。

## 4. Release Checklist
1. Promptfoo fork：`npm test`、`npm run build:app` 通过。
2. 中文语言包审校完毕，UI 走查截图。
3. Web 站部署脚本（含访问控制配置）执行并验证。
4. Electron：打包 macOS `.dmg`、Windows `.exe/.msi`，签名设置可选。
5. 生成 Release Notes：功能概要、已知限制、安装步骤、回滚方式。
6. 发布 artifacts：桌面安装包 + Web build 包 + 文档。
