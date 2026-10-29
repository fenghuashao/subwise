# Subwise P03-A 交付

打开 `SUBWISE-P03-A-REPORT.html` 即可离线阅读完整综合报告。样式、正文、PoC凭证和基线核对均在单个 HTML 内；官方来源链接需要联网。无外部 JS、字体或 CSS。

- architecture-research.md：主 Agent 综合结论、CC-Switch、模型、选型与顺序。
- platform-research.md：独立官方文档调研，关键接口已由主 Agent 复核。
- evidence/cc-switch.json：固定 commit、文件 blob SHA 与带行号公开源码摘录。
- poc/deepseek-poc.mjs、evidence/poc-results.json：无凭据隔离 PoC 与实测结果。
- evidence/baseline.json、preservation.json：原有七个规划、UI及产品文件的哈希核对。
- evidence/report-validation.json：报告结构检查与未执行项目。

Node 22+，无额外依赖。命令从项目根目录运行：

```text
node docs/mobile/p03-a/poc/deepseek-poc.mjs
node docs/mobile/p03-a/build-report.mjs
node docs/mobile/p03-a/verify-report.mjs
```

第一条默认完全离线，仅访问 loopback；带 `--probe-public` 才追加一次不带凭据的官方 DeepSeek GET，不读取任何环境变量或密钥。重跑会覆盖对应预研结果 JSON；随后重建 HTML 可更新嵌入凭证。

真实认证账户查询、三端启动包及真机验证均 NOT_RUN。浏览器工具禁止 file://，视觉检查 NOT_RUN；未绕过策略。只交付预研，原规划与 UI 保留，没有 commit/push，没有进入完整 App 开发。
