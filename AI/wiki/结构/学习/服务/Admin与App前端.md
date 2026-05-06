---
title: Admin 与 App 前端
tags:
  - pandawiki
  - 学习/阶段0
  - 服务
  - 前端
aliases:
  - Admin前端
  - App前端
  - 两个前端应用
created: '2026-04-25'
sources:
  - web/admin/
  - web/app/
  - web/packages/
---
# Admin 与 App 前端

> PandaWiki 有**两个独立前端应用**，不是一个。一个给管理员（Admin），一个给读者（App）。

## 对比

| | Admin | App |
|---|---|---|
| 端口 | `localhost:3000` | `localhost:3010` |
| 技术 | Vite + React 19 SPA | Next.js 15 SSR |
| 给谁用 | 管理员 + 编辑者 | **所有读者**（含匿名访客） |
| 路由 | React Router v7 | Next.js App Router |
| 主要场景 | 建知识库、传文档、配模型、审贡献、看统计 | 浏览文档、搜索、AI 问答、留评论 |
| 对应后端路由 | `/api/v1/*`（handler/v1） | `/share/*`（handler/share） |

## 为什么是两个独立应用而不是一个

- **Admin 重交互**：少量用户，不要 SEO，SPA 够用 → Vite 构建快
- **App 要 SEO + 首屏**：大量用户访问，可能匿名 → Next.js SSR
- **构建产物不混**：可以独立部署到 CDN

## 共享代码

```
web/
├── admin/          # 独立应用
├── app/            # 独立应用
├── packages/       # 共享：API client、组件、工具
└── pnpm-workspace.yaml
```

`web/package.json` 用 PNPM workspace 统一锁定依赖（如 React 19）。

## API client 自动生成

```bash
# 后端改 swagger 后
cd web/admin && pnpm api
cd web/app   && pnpm api
```

## 易错点

- ❌ 把 Admin 当主站：主站是 App（`:3010`），Admin 是后台
- ❌ 以为 App 只服务登录用户：取决于知识库的访问控制（可公开/密码/私有）

## source_quote

```
web/admin/vite.config.ts:57         # port: 3000
web/admin/package.json              # "dev": "vite"
web/app/package.json                # "dev": "next dev -p 3010"
web/package.json                    # React 19.2.3 工作空间共享
```

## 关联

[[Backend API 进程]] · [[端口表]] · [[业务域总览]]
