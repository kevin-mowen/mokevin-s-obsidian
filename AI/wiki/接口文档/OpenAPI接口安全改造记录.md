# OpenAPI 接口安全改造记录

## 改造背景

PandaWiki 提供 OpenAPI 接口供外部系统（FastGPT 等智能体平台、运维平台等）调用，原接口无任何认证机制，存在身份伪造、数据泄露风险。

## 涉及接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/kb/list` | 获取用户有权限的知识库列表 |
| POST | `/api/v1/kb/search/chunks` | RAG 切块检索 |
| POST | `/api/v1/kb/search/documents` | 相关文档检索 |
| POST | `/api/v1/kb/chat` | AI 问答 |
| POST | `/api/v1/kb/folders` | 获取知识库目录树 |
| POST | `/api/v1/kb/folder/docs` | 获取文件夹文档列表 |
| POST | `/api/v1/kb/upload` | 文档上传 |

## 已完成的改造

### 第一阶段（2026-04-04）

**1. API Token 认证**
- 路由组加 `Authorize` 中间件，复用现有 API Token 体系
- 调用时需在请求头携带 `Authorization: Bearer <api_token>`
- Token 在管理后台「设置 → 访问控制 → API Token」中创建

**2. 调用方标识参数**
- 所有接口统一新增 `system_id`（必填）和 `agent_id`（选填）

**3. 调用日志入库**
- 新建 `openapi_call_logs` 表，每次调用异步写入日志
- 记录字段：system_id、agent_id、api_token_id、notes_id、endpoint、query、remote_ip、success、error_message、created_at

**4. 日志自动清理**
- 定时任务：每天 0:05 清理 90 天前的调用日志

### 第二阶段（2026-04-05）

**5. Token 知识库权限校验**
- 修复：原先任意 API Token 可访问任意知识库的数据
- `/list` 接口：返回结果按 Token 绑定的 KB 过滤
- `/search/chunks`、`/search/documents`、`/chat`：`enforceTokenKBIDs` 强制限定 kb_ids 在 Token 授权范围内，不传时自动填入 Token 绑定的 KB
- `/folders`、`/folder/docs`：`validateTokenKB` 校验 kb_id 与 Token 匹配

**6. 文档级权限过滤（visitable）**
- `/folders` 和 `/folder/docs` 加 `FilterVisitableNodeIDs` 过滤
- `closed` 的节点不返回，`partial` 的节点只有授权用户组/个人能看到
- 与搜索接口的行为一致

**7. 新增目录浏览接口**
- `/api/v1/kb/folders`：获取知识库文件夹目录树（嵌套结构）
- `/api/v1/kb/folder/docs`：获取指定文件夹下的文档列表（分页，含 has_more）

**8. 搜索接口新增精确过滤参数**
- `search/chunks` 和 `search/documents` 新增 `folder_id`、`node_ids` 参数
- 支持只搜指定文件夹或指定文档内的内容
- `chat` 接口预留了参数但暂未实现过滤

**9. 文档上传接口**
- `/api/v1/kb/upload`：multipart 上传文件，同步完成解析 → 转换 → 创建节点
- 支持：指定文件夹（parent_id）、自定义标题（doc_name）、同名覆盖（overwrite）、自动发布（auto_publish，默认 false）
- 自动发布时会同时发布父文件夹

### 第三阶段（2026-04-07）

**10. 系统级 API Token**
- 新增独立的系统级 API Token 体系，与现有 KB 级别 Token 并行
- 系统 Token 由超级管理员在「系统配置 → 系统 API Token」中创建和管理
- 支持两种作用域：`scope=all`（全部知识库，新建 KB 自动纳入）和 `scope=selected`（手动多选指定 KB）
- 统一权限级别：一个 Token 对所有关联 KB 使用相同权限（full_control / doc_manage / data_operate）
- Token 脱敏：列表中只显示前 8 位 + `****`，完整 Token 仅创建时展示一次

**11. 中间件多级 Token 查找**
- `validateAPIToken` 改为顺序查找：先查 KB Token → 未命中再查系统 Token
- `ValidateKBUserPerm` 新增系统 Token 分支：scope=all 直接通过 KB 检查，scope=selected 检查 kb_id 是否在允许列表中
- 两种 Token 使用相同的 Redis 缓存模式（30 分钟 TTL），key 命名空间隔离

**12. OpenAPI 接口适配多 KB**
- `validateTokenKB`：系统 Token scope=all 直接通过，scope=selected 检查 kb_id 在 AllowedKBIDs 中
- `enforceTokenKBIDs`：系统 Token scope=all 不限制（透传），scope=selected 未指定 kb_ids 时返回所有允许的 KB
- `ListKBs`：系统 Token scope=all 不过滤，scope=selected 按 AllowedKBIDs 过滤

**13. 系统 Token 管理接口**
- `GET /api/pro/v1/system-token/list` — 列表（Token 脱敏）
- `POST /api/pro/v1/system-token/create` — 创建（返回完整 Token）
- `PATCH /api/pro/v1/system-token/update` — 更新
- `DELETE /api/pro/v1/system-token/delete` — 删除
- 所有接口均需 admin 角色

**14. 前端管理界面**
- 在系统配置弹窗新增「系统 API Token」Tab 页
- 支持创建（选择权限、scope、KB 多选）、编辑、删除
- 创建成功后弹窗展示完整 Token（仅此一次）

## 修改文件清单

| 文件                                                                  | 改动                                        |
| ------------------------------------------------------------------- | ----------------------------------------- |
| `backend/handler/openapi/kb.go`                                     | 主要开发文件：认证 + 参数 + 日志 + Token KB 校验 + 7 个接口 + 多 KB 适配 |
| `backend/store/pg/migration/000048_create_openapi_call_logs.up.sql` | 调用日志表                                     |
| `backend/store/pg/migration/000049_create_system_api_tokens.up.sql` | 系统 Token 两张表                              |
| `backend/domain/system_api_token.go`                                | 系统 Token Domain 模型                        |
| `backend/domain/api_token.go`                                       | CtxAuthInfo 新增 IsSystemToken/SystemScope/AllowedKBIDs |
| `backend/api/token/v1/system_api_token.go`                          | 系统 Token API 请求/响应类型                     |
| `backend/repo/pg/system_api_token.go`                               | 系统 Token Repo（含 Redis 缓存）                |
| `backend/usecase/system_api_token.go`                               | 系统 Token 业务逻辑（含脱敏）                      |
| `backend/handler/pro/v1/system_api_token.go`                        | 系统 Token 管理 API Handler                  |
| `backend/middleware/jwt.go`                                         | 多级 Token 查找 + 系统 Token 权限校验              |
| `backend/middleware/auth.go`                                        | NewAuthMiddleware 签名更新                    |
| `backend/repo/pg/provider.go`                                       | 注册 Repo                                   |
| `backend/usecase/provider.go`                                       | 注册 Usecase                                |
| `backend/handler/pro/v1/provider.go`                                | 注册 Handler                                |
| `backend/repo/pg/openapi_call_log.go`                               | 调用日志 Repo                                 |
| `backend/repo/pg/node.go`                                           | 新增 GetDocsByParentID 分页查询                 |
| `backend/usecase/portal.go`                                         | 新增 FilterVisitableNodeIDs 公开方法            |
| `backend/handler/mq/cron.go`                                        | 日志清理定时任务                                  |
| `web/admin/src/request/pro/SystemApiToken.ts`                       | 前端 API 请求层                                |
| `web/admin/src/components/System/component/SystemApiToken.tsx`      | 前端管理组件                                    |
| `web/admin/src/components/System/index.tsx`                         | 系统配置弹窗新增 Tab                              |
| `backend/cmd/api/wire_gen.go`                                       | Wire 自动生成                                 |
| `backend/cmd/consumer/wire_gen.go`                                  | Wire 自动生成                                 |

---

## 待验证的安全加固方案

以下方案已分析但尚未实施，后续根据需要选择：

### 方案 A：HMAC 签名（防截获、防重放、防篡改）

- 将 Token 拆为 `api_key`（公开标识）+ `api_secret`（签名密钥）
- 调用方用 `api_secret` 在本地签名：`HMAC-SHA256(api_secret, timestamp + api_key + body)`
- 请求携带 `api_key`、`X-Timestamp`、`X-Signature`，`api_secret` 不上网
- 服务端重算签名对比，timestamp 超过 5 分钟则拒绝
- **适用场景**：公网调用、高安全要求

### 方案 B：IP 白名单（防非授权机器调用）

- api_tokens 表加 `allowed_ips` 字段（TEXT 数组）
- 中间件校验请求 IP 是否在白名单内
- 非白名单 IP 请求记录告警日志
- **适用场景**：调用方 IP 固定（如内网服务器）

### 方案 C：临时 Token + 系统注册（OAuth2 Client Credentials 风格）

- 新建应用注册表，新增换 Token 接口
- 调用方先用 app_id + app_secret 换取临时 access_token（2小时有效）
- **适用场景**：多外部系统接入、需要统一管理

### 优先级建议

| 优先级 | 方案 | 理由 |
|--------|------|------|
| 高 | B - IP 白名单 | 改动小、效果明显、内网场景最实用 |
| 低 | A - HMAC 签名 | 内网 + HTTPS 场景收益有限 |
| 低 | C - 临时 Token | 改动大，当前规模不需要 |

## 踩坑记录

### CreateNodeReq.MaxNode 未设置导致创建文档失败
- **问题**: 上传接口创建文档时报错，节点数量检查 `count >= 0` 永远成立
- **原因**: `MaxNode` 默认为 0，未从 License 配置中读取
- **解决**: 设置 `MaxNode: domain.GetBaseEditionLimitation(ctx).MaxNode`

### 发布后 RAG 未触发学习（仍显示「待学习」）
- **问题**: 只调了 `UpdateNodeStatus` 改状态，RAG 没有开始学习
- **原因**: 真正的发布需要调 `KnowledgeBaseUsecase.CreateKBRelease`，它会创建 release 记录 + 更新 rag_info + 通过 MQ 触发 RAG 向量化
- **解决**: 改用 `kbUsecase.CreateKBRelease`

### 发布文档但父文件夹仍显示「未发布」
- **问题**: 上传到文件夹并自动发布后，文件夹仍显示未发布
- **原因**: 只发布了文档，没有发布父文件夹
- **解决**: 发布 NodeIDs 中同时包含文档 ID 和 parent_id

## 变更历史

- 2026-04-07: 系统级 API Token 体系 + 中间件多级查找 + OpenAPI 多 KB 适配 + 管理接口和前端界面
- 2026-04-05: Token KB 权限校验 + 文档级权限过滤 + 目录浏览接口 + 搜索过滤参数 + 文档上传接口
- 2026-04-04: API Token 认证 + system_id/agent_id 参数 + 调用日志入库 + 定时清理
