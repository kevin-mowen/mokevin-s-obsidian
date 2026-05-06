---
title: dev 模式与 local 模式
tags:
  - pandawiki
  - 学习/阶段0
  - 架构
  - 部署
aliases:
  - dev vs local
  - 三种部署形态
created: '2026-04-25'
sources:
  - scripts/dev-services-cl.sh
  - scripts/local-services-cl.sh
  - docker/dev/
  - docker/local/
---
# dev 模式与 local 模式

> 同一个项目有三种启动形态，端口和拓扑都不同。看到任何文档前先确认它说的是哪种模式。

## 三种模式对比

| 维度 | **dev 模式** ✅ 日常开发 | **local 模式** | **生产** |
|---|---|---|---|
| 入口脚本 | `scripts/dev-services-cl.sh` | `scripts/local-services-cl.sh` | `manager.sh` |
| 基础设施 | Docker 容器 | Docker 容器 | Docker 容器 |
| 后端业务 | **宿主机** `go run` | 容器内 | 容器内 |
| 前端业务 | **宿主机** `pnpm dev` | 容器内 | 容器内 |
| 反向代理 | 无（直连端口） | Caddy 8080/2443 | Caddy/Nginx |
| 域名 | `dev.localhost` | `dev.localhost` + Caddy | 真实域名 |
| 热重载 | ✅ 直接重启 | ❌ 需重建镜像 | — |
| 用途 | 二开日常 | 跑生产相同形态 | 实际部署 |

## 当前默认（你日常在用的）

**dev 模式** — `scripts/dev-services-cl.sh`，菜单选 `20`。

```
基础服务（容器）              业务服务（宿主机直接跑）
─────────────                ────────────────────────
PG       :13100              Admin    :3000  (vite dev)
Redis    :13500              App      :3010  (next dev)
NATS     :13200              API      :18000 (go run ./cmd/api)
MinIO    :13600              Consumer 无端口  (go run ./cmd/consumer)
Qdrant   :13701
Raglite  :13400
Crawler  :13800
```

## 文档里看到这些字样的对应关系

| 描述 | 对应模式 | 警示 |
|---|---|---|
| `bash dev-start.sh` | ❌ 不存在 | 旧文档错误 |
| `docker-compose -f docker-compose.dev.yml` | ❌ 不存在 | 旧文档错误 |
| 主站 :8080 / 后台 :2443 | local 或生产 | 不是 dev 模式 |
| Admin :3000 / App :3010 / API :18000 | dev 模式 ✅ | 当前在用 |
| Caddy :2019 admin API | local / 生产 | dev 不启用 Caddy |

## 易错点

- ❌ 看 `docker/dev/配置说明.md` 上写 `caddy 8080`，以为 dev 模式有 Caddy → 实际 dev 不启用
- ❌ 在 dev 模式下访问 `:8080` 找主站 → 应是 `:3010`（App）

## source_quote

```
scripts/dev-services-cl.sh:92          # show_menu 看 27 个菜单选项
scripts/local-services-cl.sh           # local 模式入口
docker/dev/docker-compose.*.yml        # 7 份基础服务 compose
docker/local/                          # local 模式的 compose
backend/config/config.local.yml        # dev 模式后端配置
```

## 关联

[[五大子系统]] · [[端口表]] · [[Backend API 进程]]
