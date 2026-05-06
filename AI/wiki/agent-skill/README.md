# PandaWiki Agent Skill 接入指引

本目录是给 **Skill 开发者 / 调用方系统** 的对接参考，用于把 PandaWiki 的知识库能力封装成一个可供 Agent 调用的 Skill（MCP Tool、Cursor Skill、自研工具等均适用）。

## 角色关系

```
┌──────────────────┐    ┌────────────────────┐    ┌──────────────────┐
│  PandaWiki       │    │  Skill 使用方      │    │  最终用户        │
│  （能力提供方）  │    │  （调用方系统）    │    │                  │
│                  │    │                    │    │                  │
│  管理员签发：    │───►│  在部署环境中配置  │    │  使用 Agent 时   │
│  token + secret  │    │  4 个连接参数      │    │  提供身份：      │
└──────────────────┘    └────────────────────┘    │  notes_id        │
                               │                   └──────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  Skill 运行时：       │
                    │  用 secret 加密       │
                    │  notes_id → 调用接口  │
                    └──────────────────────┘
```

- **PandaWiki 负责**：提供 OpenAPI、签发凭证、记录调用日志
- **调用方负责**：配置连接参数、在本地用 secret 加密 notes_id、处理接口返回
- **Skill 无需自助申请流程**，token / secret 是调用方向 PandaWiki 管理员一次性领取

## 三步接入

### 第一步：向 PandaWiki 管理员领取凭证

管理员在「系统配置 → 系统 API Token」创建一个系统级 Token，会同时生成：

- `system_api_token` — 放 Authorization 头
- `secret` — 用来加密 `access_credential`

两者一次性发给调用方，调用方自行保管。

> 注意：**secret 只能放在调用方的服务端**，任何暴露到前端 / 客户端 / 第三方 Agent 运行时的位置都视同泄漏，需要联系管理员换发。

### 第二步：配置 4 个连接参数

详见 [connection-params.md](./connection-params.md)。

| 参数 | 来源 | 用途 |
|------|------|------|
| `base_url` | PandaWiki 部署地址 | 所有接口的 host |
| `system_api_token` | 管理员签发 | 鉴权 |
| `secret` | 管理员签发 | 加密 notes_id |
| `system_id` | 调用方自定义 | 区分调用来源 |

### 第三步：加密用户身份 + 调用接口

每次请求前，Skill 用 `secret` 把最终用户的 `notes_id`（工号）加密成 `access_credential`，随 body 传给接口。加密算法是标准 **AES-256-GCM**，详见 [credential-encrypt.md](./credential-encrypt.md)（含 Python / Node.js / 浏览器 JS / Go 四份参考实现）。

## 本目录索引

| 文档 | 谁会读 | 内容 |
|------|--------|------|
| [README.md](./README.md) | 所有人 | 本页（总览） |
| [connection-params.md](./connection-params.md) | Skill 开发者 | 连接参数清单与 .env 示例 |
| [credential-encrypt.md](./credential-encrypt.md) | Skill 开发者 | access_credential 加密算法与四语言实现 |
| [endpoints-overview.md](./endpoints-overview.md) | Skill 开发者 | 12 个对外接口一页纸速查 |
| [error-codes.md](./error-codes.md) | Skill 开发者 / 排障 | 统一错误码手册与建议重试策略 |
| `openapi.json`（由 `make generate` 产出）| 工具链 | 机器可读的接口 schema |

详细的单接口字段说明见 Obsidian `AI/wiki/接口文档/`，本目录只做接入层面的最小集。

## 健康检查

所有对外接口除鉴权接口外都有一个免鉴权的 `GET /api/v1/kb/ping`，调用方首次接入或排障时可先打这个：

```bash
curl http://<base_url>/api/v1/kb/ping
# {"ok":true,"server_time":"2026-04-22T14:30:00+08:00"}
```

通 → `base_url` 和网络都对；不通 → 先排 URL / 防火墙，再排鉴权。

## 常见接入问题

- **401**：先看是不是 KB 级别 Token 混用；对外接口只接受**系统级** Token
- **40001 解密失败**：八成是 secret 配错了，或者 `access_credential` 被截断（Base64 里的 `+`/`/` 没做 URL 编码处理）
- **40003 用户不存在**：notes_id 没有通过 CAS 同步到 PandaWiki 用户表

更多错误见 [error-codes.md](./error-codes.md)。

## 变更历史

- 2026-04-22: 初始化 Agent Skill 接入指引
