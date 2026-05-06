# CHANGELOG — Agent Skill 接入指引

## 2026-04-22 初始交付

### 背景

PandaWiki 已经完成 12 个 `/api/v1/kb/*` 对外接口（见 Obsidian `AI/wiki/接口文档/`），但只有"给人读"的 Markdown 文档。外部 Agent / Skill 框架要接入时缺少：
- 机器可读的 OpenAPI schema
- 统一的接入指引和加密参考实现
- 连通性健康检查接口

本次交付把这三块补齐，让外部系统能按文档自助接入、排障、生成客户端。

### 交付清单

#### 文档（`docs/agent-skill/`）

| 文件 | 用途 |
|------|------|
| `README.md` | 总览、角色图、三步接入流程、目录索引 |
| `connection-params.md` | 4 必填 + 2 可选连接参数清单，不强制变量名 |
| `credential-encrypt.md` | AES-256-GCM 算法规格 + Python/Node/Browser JS/Go 四份参考实现 + 自检用例 |
| `error-codes.md` | 401/403/40001/40003/40004/50001 详解 + 重试策略 + 排障流程图 |
| `endpoints-overview.md` | 12 个对外接口速查 + 4 种常见调用链 + 统一截断规则 |
| `openapi.json` | 由 `make generate` 自动产出，机器可读 schema（13 条路径） |

#### 后端改动（`backend/`）

| 改动 | 文件 | 内容 |
|------|------|------|
| 新增 `/api/v1/kb/ping` 健康检查 | `handler/openapi/kb.go` | 免鉴权，返回 `{ok, server_time}` |
| 补齐 `/api/v1/kb/upload` Swagger 注解 | `handler/openapi/kb.go` | 之前只有 11/12 接口挂了注解 |
| `make generate` 自动导出对外 openapi.json | `Makefile` | jq 按路径前缀切片，缺 jq 时只打警告不阻断 |

### 未做的事（故意砍掉）

- **管理后台"凭证交付包"弹窗升级**：原本打算把 token+secret+base_url+system_id 拼成 `.env` 代码块一键复制。后续评估认为它属于 DX 优化，不是 MVP 必需（管理员一个 Token 一辈子签发一次，手动抄参数的边际成本很低），砍掉。真有管理员抱怨时再补。

### 兼容性

- 所有改动**向后兼容**：仅新增路由 + 注解 + Makefile 追加一行
- 既有 12 个对外接口行为零变化
- 既有 `backend/docs/swagger.json` 路径集合**增加**了 `/api/v1/kb/ping`，未删除任何路径

### 端到端验证

```bash
# 1. 文档产出
ls docs/agent-skill/
#   README.md  connection-params.md  credential-encrypt.md
#   endpoints-overview.md  error-codes.md  openapi.json  CHANGELOG.md

# 2. 后端编译
cd backend && go build ./handler/openapi/

# 3. 生成链路
make generate
#   → docs/swagger.json 更新
#   → ../docs/agent-skill/openapi.json 同步更新，包含 13 条路径

# 4. 运行期验证（需启动服务）
curl http://<base_url>/api/v1/kb/ping
#   期望 {"ok":true,"server_time":"2026-04-22T..."}
```

### 后续可补

按优先级排序，都不是 MVP 必需：

1. **限流中间件**（P1）：按 token 做 QPS 限制，配合 `X-RateLimit-Remaining` 响应头
2. **调用方自助审计接口**（P1）：让调用方查自己 token 的 `openapi_call_logs`
3. **管理后台 Token 使用仪表盘**（P2）：调用次数、错误率趋势图
4. **官方 MCP Server**（P2）：把 12 接口封装成 MCP Tools，外部 Agent 可直接挂载
5. **长任务回调/Webhook**（P2）：文档上传 → RAG 学习完成事件推送
