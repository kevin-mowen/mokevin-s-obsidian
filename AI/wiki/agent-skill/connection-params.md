# 连接参数清单

Skill 运行时需要 **4 个必填参数 + 2 个可选参数**。参数名（是否用环境变量、用什么前缀、放配置文件还是 secret manager）由调用方自行决定，PandaWiki 不做强制。

## 必填参数

| 参数 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `base_url` | string | 部署方提供 | PandaWiki 服务地址，形如 `http://web.aiops.oa.cib:8801`，**不带** `/api/v1/kb` 前缀 |
| `system_api_token` | string | 管理员签发 | 系统级 API Token（64 位 hex），放 `Authorization: Bearer <token>` |
| `secret` | string | 管理员签发 | AES-256-GCM 加密密钥（64 位 hex = 32 字节），**只放服务端** |
| `system_id` | string | 调用方自定义 | 调用方系统编号（如 `"fastgpt"`、`"ops_platform"`），用于日志区分 |

## 可选参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `agent_id` | string | 智能体 / 应用 ID，多租户场景用来细分调用来源，普通系统留空即可 |
| `default_kb_ids` | string[] | 默认限定搜索的知识库 ID 列表，不传则走 Token 授权范围 |
| `timeout_ms` | int | 单次请求超时，建议 30000（30s）起步，`/chat` 流式场景建议 ≥ 60000 |

## .env 参考格式（非强制）

这只是**示例**命名，调用方可以自定义前缀：

```bash
# 必填
PANDAWIKI_BASE_URL=http://web.aiops.oa.cib:8801
PANDAWIKI_SYSTEM_API_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
PANDAWIKI_SYSTEM_API_SECRET=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
PANDAWIKI_SYSTEM_ID=ops_platform

# 可选
PANDAWIKI_AGENT_ID=
PANDAWIKI_DEFAULT_KB_IDS=3adce2bd-xxx,be8666e3-xxx
PANDAWIKI_TIMEOUT_MS=30000
```

## 最终用户身份：notes_id

上述 4 个参数是**部署级**配置，Skill 实例一次加载后不变。每次调用还需要运行时传入最终用户的 **notes_id**（工号）：

```
Skill.call(query="...", notes_id="015032")
  ├─ 用 secret 加密 notes_id → access_credential
  └─ 带 Authorization + system_id + access_credential 调用接口
```

notes_id 通常从调用方已有的用户会话拿（SSO、CAS、JWT 的 subject 等），Skill 自己不负责认证。

## 安全注意

1. **secret 不得暴露到前端 / 客户端 / 浏览器插件 / Agent 运行时**，它一旦泄漏等同于可以伪造任意用户身份。
2. **token 也建议只放服务端**，但泄漏风险略低（仍需要 secret 才能伪造用户）。
3. 每个 Skill 实例（或调用方系统）**使用独立的 token + secret**，便于出问题时单独吊销；不要多个系统共用一对。
4. 管理员可以随时在后台作废 token / 换发 secret，调用方要预留**热更新配置**的能力，不要把凭证硬编码到代码里。

## 如何拿到 token + secret

联系 PandaWiki 管理员。目前**不开放自助申请**——这是为了保证凭证分发可追溯，以及方便紧急吊销。

## 变更历史

- 2026-04-22: 初始化连接参数清单
