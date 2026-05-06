---
title: Backend API 进程
tags:
  - pandawiki
  - 学习/阶段0
  - 服务
  - 后端
aliases:
  - cmd/api
  - API进程
created: '2026-04-25'
sources:
  - backend/cmd/api/main.go
  - backend/server/http/
  - backend/handler/
  - backend/config/config.local.yml
---
# Backend API 进程

> Backend 的"前台接待"——所有 HTTP 请求都进它，**必须秒级响应**，慢活外包给 [[Backend Consumer 进程]]。

## 基本信息

- **入口**：`backend/cmd/api/main.go`
- **启动**：`go run ./cmd/api`（dev 模式由 `dev-services-cl.sh` 选 6）
- **端口**：`dev.localhost:18000`
- **框架**：Echo v4

## 三套 HTTP 路由

| 前缀 | handler 目录 | 给谁 | 鉴权方式 |
|---|---|---|---|
| `/api/v1/*` | `handler/v1/` | Admin 管理后台 | JWT |
| `/share/*` | `handler/share/` | App 前台 + 匿名访客 | 可选 JWT / 知识库密码 |
| `/openapi/*` | `handler/openapi/` | 第三方 / 系统级集成 | system_api_token |
| `/api/pro/v1/*` | `handler/pro/` | Pro 版功能 | JWT |

## 它做什么、不做什么

✅ **做**：
- 接 HTTP / WebSocket / SSE
- JWT / API Token 鉴权（`middleware/`）
- 调 usecase 处理业务
- **发 NATS 消息**给 Consumer 干慢活

❌ **不做**：
- 不学习文档（发消息给 Consumer 做）
- 不抓爬虫（同上）
- 不做 RAG 计算（调 [[Raglite]]）

## 鉴权链

```
Request → middleware/auth.go (JWT 验签)
        → middleware/authorize.go (权限检查)
        → handler → usecase
```

## 健康检查

```
GET http://dev.localhost:18000/health
GET http://dev.localhost:18000/swagger/index.html
```

## 易错点

- ❌ 在 API 进程里跑慢活（如调 raglite 学整本书）→ 阻塞所有用户
- ❌ 把 `/share/*` 路由也加 JWT 强制鉴权 → 匿名访客不能用

## source_quote

```
backend/cmd/api/main.go              # 进程入口
backend/server/http/                 # Echo 装配
backend/handler/base.go              # handler Provider
backend/middleware/                  # 鉴权中间件
```

## 关联

[[Backend Consumer 进程]] · [[后端分层]] · [[NATS]]
