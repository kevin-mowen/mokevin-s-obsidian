# 系统 API Token 管理

## 功能描述

超级管理员可创建系统级 API Token，关联多个知识库或全部知识库，用于系统级 OpenAPI 接口调用。入口：管理后台 → 系统配置 → 系统 API Token。

## 功能特性

- 仅超级管理员可创建和管理
- 支持两种作用域：全部知识库（新建 KB 自动包含）/ 手动多选指定 KB
- 统一权限：一个 Token 对所有关联 KB 使用相同权限级别
- Token 脱敏：列表只显示前 8 位 + `****`，完整值仅创建时展示一次
- 与现有 KB 级别 Token 完全隔离，独立表、独立缓存

## 实现文件

### 后端
- `backend/store/pg/migration/000049_create_system_api_tokens.up.sql` - 数据库迁移
- `backend/domain/system_api_token.go` - Domain 模型
- `backend/domain/api_token.go` - CtxAuthInfo 扩展（IsSystemToken/SystemScope/AllowedKBIDs）
- `backend/api/token/v1/system_api_token.go` - 请求/响应类型定义
- `backend/repo/pg/system_api_token.go` - Repository（含 Redis 缓存）
- `backend/usecase/system_api_token.go` - 业务逻辑（含 Token 脱敏）
- `backend/handler/pro/v1/system_api_token.go` - HTTP Handler
- `backend/middleware/jwt.go` - 认证中间件（多级 Token 查找 + 权限校验）
- `backend/middleware/auth.go` - 中间件工厂函数签名更新
- `backend/handler/openapi/kb.go` - OpenAPI 辅助函数适配多 KB

### 前端
- `web/admin/src/request/pro/SystemApiToken.ts` - API 请求层
- `web/admin/src/components/System/component/SystemApiToken.tsx` - 管理组件
- `web/admin/src/components/System/index.tsx` - 系统配置弹窗 Tab 注册

## 数据结构

### 主表: system_api_tokens

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | TEXT PK | UUID 主键 |
| name | TEXT | Token 名称 |
| user_id | TEXT | 创建者用户 ID |
| token | TEXT UNIQUE | Token 值（64 位 hex，256 bits） |
| permission | TEXT | full_control / doc_manage / data_operate |
| scope | TEXT | all（全部知识库）/ selected（指定知识库） |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

### 关联表: system_token_kbs

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | SERIAL PK | 自增主键 |
| system_token_id | TEXT FK | 关联 system_api_tokens.id，ON DELETE CASCADE |
| kb_id | TEXT | 知识库 ID |
| created_at | TIMESTAMPTZ | 创建时间 |

唯一约束: (system_token_id, kb_id)
索引: system_token_id, kb_id

## API 接口

### 管理接口（仅 admin）

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/api/pro/v1/system-token/list` | 获取列表（Token 脱敏） |
| POST | `/api/pro/v1/system-token/create` | 创建（返回完整 Token） |
| PATCH | `/api/pro/v1/system-token/update` | 更新名称/权限/scope/KB 关联 |
| DELETE | `/api/pro/v1/system-token/delete` | 删除 |

### 使用接口（Bearer Token 认证）

系统 Token 可用于所有 OpenAPI 接口（`/api/v1/kb/*`），与 KB 级别 Token 使用方式相同，区别在于可跨多个知识库。

## 权限控制

| 操作 | 所需权限 |
|-----|---------|
| 创建/编辑/删除系统 Token | admin 角色 |
| 使用系统 Token 调用 OpenAPI | Token 自身的 permission 级别 |

## 依赖关系

- 上游依赖: 用户认证模块（JWT）、权限系统（ValidateUserRole）、知识库模块（kbList）、Redis 缓存
- 下游影响: OpenAPI 所有接口（validateTokenKB、enforceTokenKBIDs、ListKBs 过滤逻辑）

## 功能边界

- 本模块负责: 系统 Token 的 CRUD、Token 鉴权（中间件查找 + 权限校验）、OpenAPI 多 KB 适配
- 本模块不负责: OpenAPI 接口的具体业务逻辑（由 openapi/kb.go 处理）、KB 级别 Token 管理（由现有 api_token 模块处理）、调用日志记录（由 openapi_call_log 模块处理）

## 注意事项

- Token 查找顺序：先查 KB Token → 再查系统 Token，两表 token 列同为 64 位 hex，理论碰撞概率可忽略（2^256 空间）
- 缓存 key 命名空间隔离：KB Token 用 `api_token:{token}`，系统 Token 用 `system_api_token:{token}`
- scope=all 时 system_token_kbs 表无记录，运行时不检查 KB 列表
- 更新/删除系统 Token 时需清除 Redis 缓存
- `generateToken()` 函数在 `usecase/api_token.go` 中定义（未导出），系统 Token usecase 中复用同样的逻辑

## 变更历史

- 2026-04-07: 功能初始实现（后端 + 前端 + 文档）
