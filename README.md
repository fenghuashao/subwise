# Subwise

本地优先（local-first）的 AI 订阅与用量管理工作台：集中管理 MiniMax、DeepSeek 等 AI 平台的费用、周期与续费提醒，数据留在本机，无需账户。

## 功能

- **订阅管理**：新增 / 编辑 / 归档，支持周期与多币种
- **续费提醒**：可配置提醒天数，总览页聚合展示
- **用量快照**：API 消费、余额、Token、请求数等分窗口展示；缺失值显示"未知"，不作零值
- **平台连接**：MiniMax / DeepSeek 官方接口直连查询真实用量，连接状态可视化
- **本地优先**：全部数据存于浏览器 localStorage，无云端依赖

## 快速开始

要求 Node.js >= 22，服务端零依赖（仅用 Node 内置模块）。

```bash
npm start
# 打开 http://127.0.0.1:4173
```

### 环境变量（可选）

用于连接 AI 平台查询真实用量；不设置则跳过对应平台，不影响本地管理功能。

| 变量 | 用途 |
|---|---|
| `MINIMAX_SUBSCRIPTION_KEY` | MiniMax 订阅用量查询 |
| `DEEPSEEK_API_KEY` | DeepSeek 用量查询 |

密钥只从环境变量读取，不落盘、不进代码。

## 项目结构

```
├── index.html / styles.css / app.js   # 前端工作台（原生三件套，无构建）
├── server.js                          # 零依赖 Node 静态服务 + API 代理
├── mobile/                            # 移动端技术验证（P03 阶段）
│   ├── p03-b/rn/                      # React Native (Expo) 探针工程
│   └── p03-b/harmony/                 # HarmonyOS 原生探针工程
└── docs/mobile/                       # 阶段规划、调研与验收报告
    ├── PLAN.md                        # 移动端规划与验收基线
    ├── p03-a/                         # 架构调研与选型报告
    ├── p03-b/                         # RN / HarmonyOS 技术验证报告
    └── p03-b1/                        # 构建与模拟器验证报告
```

> docs 中保留了结构化验证证据（`*.json`）；原始构建日志与交接压缩包未纳入仓库。

## API

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/capabilities` | GET | 平台连接能力清单 |
| `/api/usage/minimax` | GET | MiniMax 用量（需环境变量） |
| `/api/usage/deepseek` | GET | DeepSeek 用量（需环境变量） |

## 移动端

移动端处于 P03 技术验证阶段，规划与验收基线见 [docs/mobile/PLAN.md](docs/mobile/PLAN.md)。RN 探针工程基于 Expo 55 / React Native 0.83：

```bash
cd mobile/p03-b/rn
npm install
npm test        # node --test tests/*.test.mjs
npm run check   # tsc --noEmit
```

## License

[MIT](LICENSE)
