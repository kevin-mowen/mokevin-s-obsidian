# PandaWiki API 接口文档

> 本地 API 地址: `http://localhost:18000`
>
> 所有接口均为 HTTP RESTful API，可通过 curl / Postman / 代码调用。
>
> **注意**: 开启了企业认证（CAS）的知识库，其 Share API 中需要 `Authorize` 中间件的接口（如 chat/message、chat/search、node/list、node/detail、comment、stat、file/upload 等）必须携带 CAS session cookie 才能调用，本文档不再列出这些接口。如需调用，请先在浏览器完成 CAS 登录后复制 cookie。

---

## 目录

- [一、认证方式说明](#一认证方式说明)
- [二、Share API — 无需 CAS 的公开接口](#二share-api--无需-cas-的公开接口)
- [三、管理后台 API（JWT 认证）](#三管理后台-apijwt-认证)
- [四、OpenAPI（notes_id Token 认证）](#四openapinotes_id-token-认证)
- [五、Pro 企业版 API（JWT + 企业许可）](#五pro-企业版-apijwt--企业许可)
- [六、系统 API Token 管理（Admin JWT）](#六系统-api-token-管理admin-jwt)

---

## 一、认证方式说明

| 认证方式 | 说明 | 适用范围 |
|----------|------|----------|
| **无认证** | 直接调用 | Share 部分公开接口 |
| **JWT Token** | `Authorization: Bearer <TOKEN>` | 管理后台全部接口 |
| **App Secret Key** | `Authorization: Bearer <secret_key>`（应用配置中设置） | chat/completions |
| **notes_id** | 请求体中携带 `notes_id` | OpenAPI 第三方集成（KB 级别 Token） |
| **系统 API Token** | `Authorization: Bearer <system_token>` | OpenAPI 第三方集成（系统级，可跨多个知识库） |
| **CAS Session** | 浏览器登录后的 cookie（本文档不涉及） | 开启企业认证的 Share 接口 |

### 获取 JWT Token

```bash
TOKEN=$(curl -s -X POST http://localhost:18000/api/v1/user/login \
  -H "Content-Type: application/json" \
  -d '{"account": "admin", "password": "Admin@2025"}' | jq -r '.data.token')

echo $TOKEN
```

---

## 二、Share API — 无需 CAS 的公开接口

文件位置: `backend/handler/share/`

以下接口无论知识库是否开启 CAS 认证都可以直接调用。

### 2.1 OpenAI 兼容聊天 (`chat.go`)

#### POST /share/v1/chat/completions — OpenAI 兼容接口

**认证**: App Secret Key（在管理后台「应用配置 → OpenAI API Bot」中设置）

```bash
curl -X POST http://localhost:18000/share/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-KB-ID: <知识库ID>" \
  -H "Authorization: Bearer <应用配置中的secret_key>" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "什么是PandaWiki？"}],
    "stream": false
  }'
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| model | string | 否 | 模型名称 |
| messages | []object | 是 | OpenAI 格式消息列表（至少1条） |
| stream | bool | 否 | 是否 SSE 流式输出 |

**前置条件**: 需在管理后台开启 OpenAI API Bot 并配置 Secret Key。

---

#### POST /share/v1/chat/widget — 挂件聊天（SSE 流式）

**认证**: 无（需 X-KB-ID，且该知识库的 Widget Bot 需开启）

```bash
curl -X POST http://localhost:18000/share/v1/chat/widget \
  -H "Content-Type: application/json" \
  -H "X-KB-ID: <知识库ID>" \
  -d '{
    "message": "你好",
    "app_type": 2,
    "conversation_id": ""
  }'
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | 是 | 用户消息 |
| app_type | int | 是 | 必须为 2（widget） |
| conversation_id | string | 否 | 会话ID（续聊时传入） |
| image_paths | []string | 否 | 图片路径（最多3张） |
| nonce | string | 否 | 随机数 |

**前置条件**: 需在管理后台开启 Widget Bot。

---

#### POST /share/v1/chat/feedback — 聊天反馈

**认证**: 无

```bash
curl -X POST http://localhost:18000/share/v1/chat/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "<消息ID>",
    "score": 1,
    "feedback_content": "回答很有帮助"
  }'
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message_id | string | 是 | 消息ID |
| score | int | 是 | -1=差评, 1=好评 |
| type | string | 否 | 反馈类型 |
| feedback_content | string | 否 | 反馈内容（最多200字） |

---

### 2.2 应用信息 (`app.go`)

#### GET /share/v1/app/web/info — 获取 Web 应用配置

**认证**: 无（需 X-KB-ID）

```bash
curl -s "http://localhost:18000/share/v1/app/web/info" \
  -H "X-KB-ID: <知识库ID>" | jq
```

---

### 2.3 认证配置 (`auth.go`)

#### GET /share/v1/auth/get — 获取知识库认证配置

**认证**: CheckForbidden（仅检查是否禁用，不检查 CAS）

```bash
curl -s "http://localhost:18000/share/v1/auth/get" \
  -H "X-KB-ID: <知识库ID>" | jq
```

返回: `auth_type`、`source_type`、`license_edition`

---

#### POST /share/v1/auth/login/simple — 简单密码登录

**认证**: CheckForbidden

```bash
curl -X POST http://localhost:18000/share/v1/auth/login/simple \
  -H "Content-Type: application/json" \
  -H "X-KB-ID: <知识库ID>" \
  -d '{"password": "your_password"}'
```

---

### 2.4 验证码 (`captcha.go`)

#### POST /share/v1/captcha/challenge — 创建验证码

**认证**: 无（需 X-KB-ID）

```bash
curl -s -X POST http://localhost:18000/share/v1/captcha/challenge \
  -H "X-KB-ID: <知识库ID>" | jq
```

---

#### POST /share/v1/captcha/redeem — 验证验证码

**认证**: 无（需 X-KB-ID）

```bash
curl -X POST http://localhost:18000/share/v1/captcha/redeem \
  -H "Content-Type: application/json" \
  -H "X-KB-ID: <知识库ID>" \
  -d '{"token": "<captcha_token>", "solutions": ["answer"]}'
```

---

### 2.5 Sitemap (`sitemap.go`)

#### GET /sitemap.xml — 获取站点地图

**认证**: 无（需 X-KB-ID）

```bash
curl "http://localhost:18000/sitemap.xml" \
  -H "X-KB-ID: <知识库ID>"
```

---

### 2.6 Portal 门户 (`portal.go`)

#### GET /share/v1/portal/auth-info — 获取门户认证信息

**认证**: 无

```bash
curl -s "http://localhost:18000/share/v1/portal/auth-info" | jq
```

---

### 2.7 Pro 认证信息 (`pro_auth.go`)

#### GET /share/pro/v1/auth/info — 获取 Pro 认证信息

**认证**: CheckForbidden

```bash
curl -s "http://localhost:18000/share/pro/v1/auth/info" \
  -H "X-KB-ID: <知识库ID>" | jq
```

---

#### POST /share/pro/v1/auth/logout — 退出登录

**认证**: 无

```bash
curl -X POST http://localhost:18000/share/pro/v1/auth/logout
```

---

#### POST /share/pro/v1/auth/cas — 获取 CAS 登录 URL

**认证**: CheckForbidden

```bash
curl -s -X POST http://localhost:18000/share/pro/v1/auth/cas \
  -H "Content-Type: application/json" \
  -H "X-KB-ID: <知识库ID>" \
  -d '{"redirect_url": "http://dev.localhost:3010"}' | jq
```

返回 CAS 登录跳转 URL。

---

#### POST /share/pro/v1/auth/admin-token — 获取管理员 Token

**认证**: CheckForbidden（需有效 session）

```bash
curl -X POST http://localhost:18000/share/pro/v1/auth/admin-token \
  -H "X-KB-ID: <知识库ID>" \
  -H "Cookie: panda_wiki_session=<session_cookie>"
```

---

#### GET /share/pro/v1/auth/pending-contributes — 待审投稿数

**认证**: CheckForbidden

```bash
curl -s "http://localhost:18000/share/pro/v1/auth/pending-contributes" \
  -H "X-KB-ID: <知识库ID>" | jq
```

---

### 2.8 微信/企微/飞书集成

#### 微信服务号 (`wechat.go`)

```bash
# 验证
curl "http://localhost:18000/share/v1/app/wechat/service?msg_signature=xx&timestamp=xx&nonce=xx&echostr=xx" \
  -H "X-KB-ID: <知识库ID>"

# 消息处理
curl -X POST "http://localhost:18000/share/v1/app/wechat/service?msg_signature=xx&timestamp=xx&nonce=xx" \
  -H "X-KB-ID: <知识库ID>" \
  -H "Content-Type: application/xml" \
  -d '<xml>...</xml>'

# 获取回答（SSE 流式）
curl "http://localhost:18000/share/v1/app/wechat/service/answer?id=<会话ID>"
```

微信应用号 (`/share/v1/app/wechat/app`) 和企业微信 (`/share/v1/app/wecom/ai_bot`) 参数相同。

#### 飞书 (`openapi.go`)

```bash
curl -X POST http://localhost:18000/share/v1/openapi/lark/bot/<知识库ID> \
  -H "Content-Type: application/json" \
  -d '{"challenge": "xxx"}'
```

---

## 三、管理后台 API（JWT 认证）

文件位置: `backend/handler/v1/`

> 以下接口均需要 `Authorization: Bearer <TOKEN>`，部分接口还需要特定权限（Admin / Full Control / Doc Manage / Data Operate）。

### 3.1 用户管理 (`user.go`)

#### POST /api/v1/user/login — 用户登录（无需认证）

```bash
curl -s -X POST http://localhost:18000/api/v1/user/login \
  -H "Content-Type: application/json" \
  -d '{"account": "admin", "password": "Admin@2025"}' | jq
```

#### GET /api/v1/user — 获取当前用户信息

```bash
curl -s http://localhost:18000/api/v1/user/ \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/user/list — 用户列表 [Admin]

```bash
curl -s http://localhost:18000/api/v1/user/list \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### POST /api/v1/user/create — 创建用户 [Admin]

```bash
curl -X POST http://localhost:18000/api/v1/user/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"account": "newuser", "password": "Password@123", "role": "user"}'
```

#### PUT /api/v1/user/update — 更新用户 [Admin]

```bash
curl -X PUT http://localhost:18000/api/v1/user/update \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"id": "<用户ID>", "role": "admin"}'
```

#### PUT /api/v1/user/reset_password — 重置密码

```bash
curl -X PUT http://localhost:18000/api/v1/user/reset_password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"id": "<用户ID>", "new_password": "NewPass@123"}'
```

#### DELETE /api/v1/user/delete — 删除用户 [Admin]

```bash
curl -X DELETE "http://localhost:18000/api/v1/user/delete?user_id=<用户ID>" \
  -H "Authorization: Bearer $TOKEN"
```

---

### 3.2 知识库管理 (`knowledge_base.go`)

#### POST /api/v1/knowledge_base — 创建知识库 [Admin]

```bash
curl -X POST http://localhost:18000/api/v1/knowledge_base/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name": "测试知识库", "hosts": ["test.localhost"], "ports": [8080]}'
```

#### GET /api/v1/knowledge_base/list — 知识库列表

```bash
curl -s http://localhost:18000/api/v1/knowledge_base/list \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/knowledge_base/detail — 知识库详情

```bash
curl -s "http://localhost:18000/api/v1/knowledge_base/detail?id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### PUT /api/v1/knowledge_base/detail — 更新知识库 [Full Control]

```bash
curl -X PUT http://localhost:18000/api/v1/knowledge_base/detail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"id": "<知识库ID>", "name": "新名称"}'
```

#### DELETE /api/v1/knowledge_base/detail — 删除知识库 [Admin]

```bash
curl -X DELETE "http://localhost:18000/api/v1/knowledge_base/detail?id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN"
```

#### GET /api/v1/knowledge_base/user/list — 知识库用户列表 [Full Control]

```bash
curl -s "http://localhost:18000/api/v1/knowledge_base/user/list?kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### POST /api/v1/knowledge_base/user/invite — 邀请用户 [Full Control]

```bash
curl -X POST http://localhost:18000/api/v1/knowledge_base/user/invite \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>", "user_id": "<用户ID>", "perm": "doc_manage"}'
```

#### DELETE /api/v1/knowledge_base/user/delete — 移除用户 [Full Control]

```bash
curl -X DELETE "http://localhost:18000/api/v1/knowledge_base/user/delete?kb_id=<知识库ID>&user_id=<用户ID>" \
  -H "Authorization: Bearer $TOKEN"
```

#### POST /api/v1/knowledge_base/release — 创建发布 [Doc Manage]

```bash
curl -X POST http://localhost:18000/api/v1/knowledge_base/release/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>", "message": "v1.0", "tag": "v1.0", "node_ids": ["<节点ID>"]}'
```

#### GET /api/v1/knowledge_base/release/list — 发布列表 [Doc Manage]

```bash
curl -s "http://localhost:18000/api/v1/knowledge_base/release/list?kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### 3.3 文章管理 (`node.go`)

#### POST /api/v1/node — 创建文章 [Doc Manage]

```bash
curl -X POST http://localhost:18000/api/v1/node/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "kb_id": "<知识库ID>",
    "type": 2,
    "name": "新文章",
    "content": "<p>文章内容</p>",
    "content_type": "html"
  }'
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| kb_id | string | 是 | 知识库ID |
| type | int | 是 | 1=文件夹, 2=文档 |
| name | string | 是 | 名称 |
| content | string | 否 | 内容 |
| parent_id | string | 否 | 父节点ID |
| emoji | string | 否 | 图标 |
| content_type | string | 否 | md/html/excel |
| convert_from_md | bool | 否 | MD 转 HTML |
| position | float | 否 | 排序位置 |

#### GET /api/v1/node/list — 文章列表 [Doc Manage]

```bash
curl -s "http://localhost:18000/api/v1/node/list?kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq

# 带搜索和类型过滤
curl -s "http://localhost:18000/api/v1/node/list?kb_id=<知识库ID>&search=关键词&type=2" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/node/detail — 文章详情 [Doc Manage]

```bash
curl -s "http://localhost:18000/api/v1/node/detail?id=<节点ID>&kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### PUT /api/v1/node/detail — 更新文章 [Doc Manage]

```bash
curl -X PUT http://localhost:18000/api/v1/node/detail \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"id": "<节点ID>", "kb_id": "<知识库ID>", "name": "更新标题", "content": "<p>新内容</p>"}'
```

#### POST /api/v1/node/action — 文章操作（发布/下架） [Doc Manage]

```bash
curl -X POST http://localhost:18000/api/v1/node/action \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>", "node_id": "<节点ID>", "action": "publish"}'
```

#### POST /api/v1/node/move — 移动文章 [Doc Manage]

```bash
curl -X POST http://localhost:18000/api/v1/node/move \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>", "node_id": "<节点ID>", "parent_id": "<新父节点>", "position": 1.0}'
```

#### POST /api/v1/node/batch_move — 批量移动 [Doc Manage]

```bash
curl -X POST http://localhost:18000/api/v1/node/batch_move \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>", "node_ids": ["<节点1>", "<节点2>"], "parent_id": "<目标父节点>"}'
```

#### POST /api/v1/node/summary — AI 摘要生成 [Doc Manage]

```bash
curl -X POST http://localhost:18000/api/v1/node/summary \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>", "node_id": "<节点ID>"}'
```

#### GET /api/v1/node/recommend_nodes — 推荐相关文章 [Doc Manage]

```bash
curl -s "http://localhost:18000/api/v1/node/recommend_nodes?kb_id=<知识库ID>&node_id=<节点ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### POST /api/v1/node/restudy — 重新学习单篇 [Doc Manage]

```bash
curl -X POST http://localhost:18000/api/v1/node/restudy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>", "node_id": "<节点ID>"}'
```

#### POST /api/v1/node/restudy_all — 重新学习全部 [Doc Manage]

```bash
curl -X POST http://localhost:18000/api/v1/node/restudy_all \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>"}'
```

#### GET /api/v1/node/permission — 获取文章权限 [Doc Manage]

```bash
curl -s "http://localhost:18000/api/v1/node/permission?id=<节点ID>&kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/node/release/list — 文章版本列表 [Doc Manage]

```bash
curl -s "http://localhost:18000/api/v1/node/release/list?kb_id=<知识库ID>&node_id=<节点ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/node/release/detail — 文章版本详情 [Doc Manage]

```bash
curl -s "http://localhost:18000/api/v1/node/release/detail?kb_id=<知识库ID>&id=<版本ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### 3.4 模型管理 (`model.go`)

#### GET /api/v1/model/list — 模型列表 [Admin]

```bash
curl -s http://localhost:18000/api/v1/model/list \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### POST /api/v1/model — 创建模型 [Admin]

```bash
curl -X POST http://localhost:18000/api/v1/model/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "provider": "openai",
    "model": "gpt-4",
    "api_key": "sk-xxx",
    "base_url": "https://api.openai.com/v1",
    "type": "chat"
  }'
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| provider | string | 是 | openai/deepseek/gemini/ollama |
| model | string | 是 | 模型标识 |
| api_key | string | 是 | API Key |
| base_url | string | 否 | 自定义 Base URL |
| type | string | 是 | 模型类型 |

#### PUT /api/v1/model — 更新模型 [Admin]

```bash
curl -X PUT http://localhost:18000/api/v1/model/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"id": "<模型ID>", "api_key": "sk-new-key", "is_active": true}'
```

#### POST /api/v1/model/check — 检测模型连通性 [Admin]

```bash
curl -X POST http://localhost:18000/api/v1/model/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"provider": "openai", "model": "gpt-4", "api_key": "sk-xxx", "type": "chat"}'
```

#### POST /api/v1/model/provider/supported — 获取供应商支持的模型 [Admin]

```bash
curl -s -X POST http://localhost:18000/api/v1/model/provider/supported \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"provider": "openai", "api_key": "sk-xxx", "type": "chat"}' | jq
```

#### POST /api/v1/model/switch-mode — 切换模型模式 [Admin]

```bash
curl -X POST http://localhost:18000/api/v1/model/switch-mode \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"mode": "auto", "auto_mode_api_key": "sk-xxx"}'
```

#### GET /api/v1/model/mode-setting — 获取模式设置 [Admin]

```bash
curl -s http://localhost:18000/api/v1/model/mode-setting \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### 3.5 统计数据 (`stat.go`)

#### GET /api/v1/stat/instant_count — 实时统计（近30分钟）[Data Operate]

```bash
curl -s "http://localhost:18000/api/v1/stat/instant_count?kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/stat/instant_pages — 最近访问页面 [Data Operate]

```bash
curl -s "http://localhost:18000/api/v1/stat/instant_pages?kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/stat/count — 汇总统计 [Data Operate]

```bash
curl -s "http://localhost:18000/api/v1/stat/count?kb_id=<知识库ID>&day=7" \
  -H "Authorization: Bearer $TOKEN" | jq
```

| day | 说明 |
|-----|------|
| 1 | 最近1天 |
| 7 | 最近7天 |
| 30 | 最近30天 |

#### GET /api/v1/stat/geo_count — 地理分布 [Data Operate]

```bash
curl -s "http://localhost:18000/api/v1/stat/geo_count?kb_id=<知识库ID>&day=1" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/stat/conversation_distribution — 问答来源分布 [Data Operate]

```bash
curl -s "http://localhost:18000/api/v1/stat/conversation_distribution?kb_id=<知识库ID>&day=1" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/stat/hot_pages — 热门页面 [Data Operate]

```bash
curl -s "http://localhost:18000/api/v1/stat/hot_pages?kb_id=<知识库ID>&day=7" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/stat/referer_hosts — 来源域名 [Data Operate]

```bash
curl -s "http://localhost:18000/api/v1/stat/referer_hosts?kb_id=<知识库ID>&day=7" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/stat/browsers — 浏览器统计 [Data Operate]

```bash
curl -s "http://localhost:18000/api/v1/stat/browsers?kb_id=<知识库ID>&day=7" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/stat/operation_overview — 运营概览

```bash
curl -s "http://localhost:18000/api/v1/stat/operation_overview?day=1" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### PUT /api/v1/stat/blacklist — 更新统计黑名单

```bash
curl -X PUT http://localhost:18000/api/v1/stat/blacklist \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"exclude_kb_ids": ["<知识库ID>"]}'
```

---

### 3.6 对话记录 (`conversation.go`)

#### GET /api/v1/conversation — 对话列表 [Data Operate]

```bash
curl -s "http://localhost:18000/api/v1/conversation/?kb_id=<知识库ID>&page=1&page_size=20" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/conversation/detail — 对话详情 [Data Operate]

```bash
curl -s "http://localhost:18000/api/v1/conversation/detail?id=<对话ID>&kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/conversation/message/list — 消息列表 [Data Operate]

```bash
curl -s "http://localhost:18000/api/v1/conversation/message/list?kb_id=<知识库ID>&page=1&page_size=20" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/conversation/message/detail — 消息详情 [Data Operate]

```bash
curl -s "http://localhost:18000/api/v1/conversation/message/detail?id=<消息ID>&kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### 3.7 权限设置 (`auth.go`)

#### GET /api/v1/auth/get — 获取认证配置 [Full Control]

```bash
curl -s "http://localhost:18000/api/v1/auth/get?kb_id=<知识库ID>&source_type=simple" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### POST /api/v1/auth/set — 设置认证 [Full Control]

```bash
curl -X POST http://localhost:18000/api/v1/auth/set \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>", "source_type": "simple"}'
```

#### DELETE /api/v1/auth/delete — 删除认证 [Full Control]

```bash
curl -X DELETE "http://localhost:18000/api/v1/auth/delete?kb_id=<知识库ID>&source_type=simple" \
  -H "Authorization: Bearer $TOKEN"
```

---

### 3.8 CAS 认证 (`auth_cas.go`) — 全部无需认证

#### GET /api/v1/auth/cas/url — 获取 CAS 登录 URL

```bash
curl -s "http://localhost:18000/api/v1/auth/cas/url" | jq
```

#### POST /api/v1/auth/cas/code-exchange — 换取 Token

```bash
curl -X POST http://localhost:18000/api/v1/auth/cas/code-exchange \
  -H "Content-Type: application/json" \
  -d '{"code": "<authorization_code>"}'
```

#### GET /api/v1/auth/cas/logout-url — 获取 CAS 退出 URL

```bash
curl -s "http://localhost:18000/api/v1/auth/cas/logout-url" | jq
```

---

### 3.9 应用配置 (`app.go`)

#### GET /api/v1/app/detail — 获取应用详情 [Full Control]

```bash
curl -s "http://localhost:18000/api/v1/app/detail?kb_id=<知识库ID>&type=1" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### PUT /api/v1/app — 更新应用 [Full Control]

```bash
curl -X PUT "http://localhost:18000/api/v1/app/?id=<应用ID>" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"settings": {"key": "value"}}'
```

#### DELETE /api/v1/app — 删除应用 [Full Control]

```bash
curl -X DELETE "http://localhost:18000/api/v1/app/?id=<应用ID>&kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN"
```

---

### 3.10 评论管理 (`comment.go`)

#### GET /api/v1/comment — 评论列表 [Data Operate]

```bash
curl -s "http://localhost:18000/api/v1/comment/?kb_id=<知识库ID>&page=1&page_size=20" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### DELETE /api/v1/comment/list — 批量删除评论 [Data Operate]

```bash
curl -X DELETE "http://localhost:18000/api/v1/comment/list?ids[]=<评论ID1>&ids[]=<评论ID2>" \
  -H "Authorization: Bearer $TOKEN"
```

---

### 3.11 爬虫/导入 (`crawler.go`)

#### POST /api/v1/crawler/parse — 解析文档源

```bash
curl -X POST http://localhost:18000/api/v1/crawler/parse \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"crawler_source": "feishu", "feishu_setting": {"app_id": "xxx", "app_secret": "xxx"}}'
```

#### POST /api/v1/crawler/export — 导出内容

```bash
curl -X POST http://localhost:18000/api/v1/crawler/export \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"url": "https://example.com/doc"}'
```

#### GET /api/v1/crawler/result — 获取爬取结果

```bash
curl -s "http://localhost:18000/api/v1/crawler/result?task_id=<任务ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### POST /api/v1/crawler/results — 批量获取结果

```bash
curl -X POST http://localhost:18000/api/v1/crawler/results \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"task_ids": ["<id1>", "<id2>"]}'
```

---

### 3.12 AI 创作 (`creation.go`)

#### POST /api/v1/creation/text — 文本生成（SSE 流式）

```bash
curl -X POST http://localhost:18000/api/v1/creation/text \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>", "prompt": "帮我写一篇关于AI的文章"}'
```

#### POST /api/v1/creation/tab-complete — Tab 补全

```bash
curl -X POST http://localhost:18000/api/v1/creation/tab-complete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"prefix": "PandaWiki 是一个", "suffix": "的知识库系统"}'
```

---

### 3.13 同步 (`sync.go`)

#### POST /api/v1/sync/trigger — 触发同步

```bash
curl -X POST "http://localhost:18000/api/v1/sync/trigger?kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN"
```

#### GET /api/v1/sync/status — 同步状态

```bash
curl -s "http://localhost:18000/api/v1/sync/status?kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

### 3.14 许可证 (`license.go`)

#### GET /api/v1/license — 获取许可证

```bash
curl -s http://localhost:18000/api/v1/license/ \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### POST /api/v1/license — 上传许可证

```bash
# 通过文件
curl -X POST http://localhost:18000/api/v1/license/ \
  -H "Authorization: Bearer $TOKEN" \
  -F "license_file=@/path/to/license.lic" \
  -F "license_edition=enterprise" \
  -F "license_type=file"

# 通过 code
curl -X POST http://localhost:18000/api/v1/license/ \
  -H "Authorization: Bearer $TOKEN" \
  -F "license_code=LICENSE-CODE" \
  -F "license_edition=enterprise" \
  -F "license_type=code"
```

---

### 3.15 文件上传 (`file.go`)

#### POST /api/v1/file/upload — 上传文件

```bash
curl -X POST http://localhost:18000/api/v1/file/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/file.pdf" \
  -F "kb_id=<知识库ID>"
```

#### POST /api/v1/file/upload/url — URL 上传

```bash
curl -X POST http://localhost:18000/api/v1/file/upload/url \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"url": "https://example.com/file.pdf", "kb_id": "<知识库ID>"}'
```

#### POST /api/v1/file/upload/anydoc — AnyDoc 上传（无需认证，IP 限制）

```bash
curl -X POST http://localhost:18000/api/v1/file/upload/anydoc \
  -F "file=@/path/to/file.pdf" \
  -F "path=docs/converted/"
```

---

### 3.16 向量统计 (`vector_stats.go`) [Admin]

#### GET /api/v1/vector/stats — 知识库向量统计

```bash
curl -s "http://localhost:18000/api/v1/vector/stats?kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/vector/stats/all — 全部知识库向量统计

```bash
curl -s http://localhost:18000/api/v1/vector/stats/all \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/v1/vector/consistency — 一致性检查

```bash
curl -s "http://localhost:18000/api/v1/vector/consistency?kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### POST /api/v1/vector/cleanup/orphaned — 清理孤立向量

```bash
curl -X POST http://localhost:18000/api/v1/vector/cleanup/orphaned \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>"}'
```

#### POST /api/v1/vector/cleanup/multi-version — 清理多版本向量

```bash
curl -X POST http://localhost:18000/api/v1/vector/cleanup/multi-version \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>"}'
```

---

### 3.17 门户设置 (`portal_setting.go`)

#### GET /api/v1/portal/settings — 获取门户设置

```bash
curl -s http://localhost:18000/api/v1/portal/settings \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### PUT /api/v1/portal/settings — 更新门户设置

```bash
curl -X PUT http://localhost:18000/api/v1/portal/settings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "header": {"title": "我的知识库"},
    "banner": {"title": "欢迎", "placeholder": "搜索...", "hot_search": ["热词1"]},
    "footer": {}
  }'
```

---

## 四、OpenAPI（Token 认证）

文件位置: `backend/handler/openapi/kb.go`

> 面向第三方系统集成，支持两种 Token 认证方式：
>
> 1. **KB 级别 Token**（notes_id）：绑定单个知识库，在知识库设置中创建
> 2. **系统级 API Token**：可关联多个知识库或全部知识库，在系统配置中创建（仅管理员），通过 `Authorization: Bearer <token>` 传递
>
> 系统级 Token 的管理接口见[第六章](#六系统-api-token-管理admin-jwt)。

### POST /api/v1/kb/list — 获取知识库列表

```bash
curl -s -X POST http://localhost:18000/api/v1/kb/list \
  -H "Content-Type: application/json" \
  -d '{"notes_id": "<notes_id>"}' | jq
```

响应:
```json
{
  "success": true,
  "data": {
    "total": 1,
    "items": [{"kb_id": "xxx", "kb_name": "测试", "node_count": 10, "base_url": "..."}]
  }
}
```

---

### POST /api/v1/kb/search/chunks — 搜索文本分块

```bash
curl -s -X POST http://localhost:18000/api/v1/kb/search/chunks \
  -H "Content-Type: application/json" \
  -d '{
    "notes_id": "<notes_id>",
    "query": "什么是 RAG？",
    "kb_ids": ["<知识库ID>"],
    "top_k": 5
  }' | jq
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| notes_id | string | 是 | API Token |
| query | string | 是 | 搜索关键词 |
| kb_ids | []string | 否 | 限定知识库范围 |
| top_k | int | 否 | 返回数量 |

---

### POST /api/v1/kb/search/documents — 搜索文档

```bash
curl -s -X POST http://localhost:18000/api/v1/kb/search/documents \
  -H "Content-Type: application/json" \
  -d '{
    "notes_id": "<notes_id>",
    "query": "部署指南",
    "top_k": 10
  }' | jq
```

---

### POST /api/v1/kb/chat — AI 问答

```bash
# 非流式
curl -s -X POST http://localhost:18000/api/v1/kb/chat \
  -H "Content-Type: application/json" \
  -d '{
    "notes_id": "<notes_id>",
    "query": "如何部署 PandaWiki？",
    "stream": false
  }' | jq

# 流式（SSE）
curl -X POST http://localhost:18000/api/v1/kb/chat \
  -H "Content-Type: application/json" \
  -d '{
    "notes_id": "<notes_id>",
    "query": "如何部署 PandaWiki？",
    "stream": true
  }'
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| notes_id | string | 是 | API Token |
| query | string | 是 | 问题 |
| kb_ids | []string | 否 | 限定知识库范围 |
| stream | bool | 是 | 是否流式输出 |
| conversation_id | string | 否 | 会话ID（续聊） |
| nonce | string | 否 | 随机数 |

---

## 五、Pro 企业版 API（JWT + 企业许可）

文件位置: `backend/handler/pro/v1/`

> 需要企业版许可证 + JWT 认证。

### 5.1 权限配置 (`auth.go`)

#### GET /api/pro/v1/auth/get — 获取认证配置（分页）[Full Control]

```bash
curl -s "http://localhost:18000/api/pro/v1/auth/get?kb_id=<知识库ID>&source_type=cas&page=1&page_size=10" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### POST /api/pro/v1/auth/set — 设置认证 [Full Control]

```bash
curl -X POST http://localhost:18000/api/pro/v1/auth/set \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>", "source_type": "cas", "cas_url": "https://cas.example.com", "cas_version": "3.0"}'
```

#### GET /api/pro/v1/auth/search — 搜索用户 [Full Control]

```bash
curl -s "http://localhost:18000/api/pro/v1/auth/search?kb_id=<知识库ID>&source_type=cas&keyword=张三" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### DELETE /api/pro/v1/auth/delete — 删除认证 [Full Control]

```bash
curl -X DELETE "http://localhost:18000/api/pro/v1/auth/delete?id=1&kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN"
```

---

### 5.2 权限分组 (`auth_group.go`)

#### POST /api/pro/v1/auth/group/create — 创建分组 [Full Control]

```bash
curl -X POST http://localhost:18000/api/pro/v1/auth/group/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name": "研发部", "kb_id": "<知识库ID>", "auth_ids": [1, 2, 3]}'
```

#### GET /api/pro/v1/auth/group/list — 分组列表 [Full Control]

```bash
curl -s "http://localhost:18000/api/pro/v1/auth/group/list?kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/pro/v1/auth/group/tree — 分组树 [Full Control]

```bash
curl -s "http://localhost:18000/api/pro/v1/auth/group/tree?kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/pro/v1/auth/group/detail — 分组详情 [Full Control]

```bash
curl -s "http://localhost:18000/api/pro/v1/auth/group/detail?id=1&kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### PATCH /api/pro/v1/auth/group/update — 更新分组 [Full Control]

```bash
curl -X PATCH http://localhost:18000/api/pro/v1/auth/group/update \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"id": 1, "name": "新名称", "kb_id": "<知识库ID>", "auth_ids": [1, 2]}'
```

#### PATCH /api/pro/v1/auth/group/move — 移动分组 [Full Control]

```bash
curl -X PATCH http://localhost:18000/api/pro/v1/auth/group/move \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"id": 1, "kb_id": "<知识库ID>", "parent_id": 2, "position": 1.0}'
```

#### DELETE /api/pro/v1/auth/group/delete — 删除分组 [Full Control]

```bash
curl -X DELETE "http://localhost:18000/api/pro/v1/auth/group/delete?id=1&kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN"
```

#### POST /api/pro/v1/auth/group/sync — 同步组织架构 [Admin]

```bash
curl -X POST http://localhost:18000/api/pro/v1/auth/group/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>", "source_type": "dingtalk"}'
```

---

### 5.3 API Token (`api_token.go`)

> 这里创建的 Token 就是 OpenAPI（第四章）使用的 `notes_id`。

#### GET /api/pro/v1/token/list — Token 列表 [Full Control]

```bash
curl -s "http://localhost:18000/api/pro/v1/token/list?kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### POST /api/pro/v1/token/create — 创建 Token [Full Control]

```bash
curl -s -X POST http://localhost:18000/api/pro/v1/token/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>", "name": "第三方集成", "permission": "data_operate"}' | jq
```

| permission | 说明 |
|------------|------|
| full_control | 完全控制 |
| doc_manage | 文档管理 |
| data_operate | 数据操作 |

#### PATCH /api/pro/v1/token/update — 更新 Token [Full Control]

```bash
curl -X PATCH http://localhost:18000/api/pro/v1/token/update \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"id": "<token_id>", "kb_id": "<知识库ID>", "name": "新名称"}'
```

#### DELETE /api/pro/v1/token/delete — 删除 Token [Full Control]

```bash
curl -X DELETE "http://localhost:18000/api/pro/v1/token/delete?id=<token_id>&kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN"
```

---

### 5.4 投稿管理 (`contribute.go`)

#### GET /api/pro/v1/contribute/list — 投稿列表 [Full Control]

```bash
curl -s "http://localhost:18000/api/pro/v1/contribute/list?kb_id=<知识库ID>&page=1&per_page=20" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### GET /api/pro/v1/contribute/detail — 投稿详情 [Full Control]

```bash
curl -s "http://localhost:18000/api/pro/v1/contribute/detail?id=<投稿ID>&kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### POST /api/pro/v1/contribute/audit — 审核投稿 [Full Control]

```bash
curl -X POST http://localhost:18000/api/pro/v1/contribute/audit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"id": "<投稿ID>", "kb_id": "<知识库ID>", "status": "approved"}'
```

| status | 说明 |
|--------|------|
| approved | 通过 |
| rejected | 拒绝 |

---

### 5.5 评论审核 (`comment.go`)

#### POST /api/pro/v1/comment_moderate — 批量审核评论 [Data Operate]

```bash
curl -X POST http://localhost:18000/api/pro/v1/comment_moderate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>", "ids": ["<评论ID1>", "<评论ID2>"], "status": "approved"}'
```

---

### 5.6 屏蔽词 (`block.go`)

#### GET /api/pro/v1/block — 获取屏蔽词 [Full Control]

```bash
curl -s "http://localhost:18000/api/pro/v1/block/?kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### POST /api/pro/v1/block — 设置屏蔽词 [Full Control]

```bash
curl -X POST http://localhost:18000/api/pro/v1/block/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>", "words": ["敏感词1", "敏感词2"]}'
```

---

### 5.7 自定义 Prompt (`prompt.go`)

#### GET /api/pro/v1/prompt — 获取 Prompt [Full Control]

```bash
curl -s "http://localhost:18000/api/pro/v1/prompt/?kb_id=<知识库ID>" \
  -H "Authorization: Bearer $TOKEN" | jq
```

#### POST /api/pro/v1/prompt — 设置 Prompt [Full Control]

```bash
curl -X POST http://localhost:18000/api/pro/v1/prompt/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"kb_id": "<知识库ID>", "content": "你是一个专业的知识库助手..."}'
```

---

## 附录

### 统一响应格式

```json
// 管理后台 & Share API
{"message": "", "success": true, "data": {...}, "code": 0}

// 错误
{"message": "error msg", "success": false, "code": 0}
```

### 权限级别

| 权限 | 标识 | 说明 |
|------|------|------|
| 系统管理员 | Admin | 所有操作 |
| 完全控制 | full_control | 知识库全部设置 |
| 文档管理 | doc_manage | 文章 CRUD、发布 |
| 数据操作 | data_operate | 统计、对话、评论 |

### 接口统计

| 分类 | 数量 | 认证方式 |
|------|------|----------|
| Share（无需CAS） | ~15 | 无/Secret Key/CheckForbidden |
| 管理后台 V1 | ~55 | JWT Token |
| OpenAPI | 4 | notes_id |
| Pro 企业版 | ~20 | JWT + 企业许可 |
| ~~Share（需CAS session）~~ | ~~16~~ | ~~已排除~~ |
