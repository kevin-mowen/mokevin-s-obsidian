---
title: NATS
tags:
  - pandawiki
  - 学习/阶段0
  - 服务
  - 消息队列
aliases:
  - 消息队列
  - 异步管道
created: '2026-04-25'
sources:
  - backend/handler/mq/
  - backend/store/
  - docker/dev/docker-compose.nats.yml
---
# NATS

> Backend 内部的"异步管道"。仅供 [[Backend API 进程]] 和 [[Backend Consumer 进程]] 协作，不对外。

## 基本信息

- **容器**：`panda-wiki-nats`
- **端口**：`dev.localhost:13200`
- **协议**：NATS（不是 Kafka，不是 RabbitMQ）

## 它在干啥

```
API 进程                         Consumer 进程
────────                         ──────────────
1. 接到请求                       2. 订阅 subject
2. 写完 PG                        3. 收到消息后调 raglite/爬虫等
3. 发个 NATS 消息  ──── NATS ───► 4. 慢慢做完
4. 立即返回响应给用户
```

## 典型 subject

| subject | 谁发 | 谁收 | 干啥 |
|---|---|---|---|
| `node.release` | API（文档发布） | mq/node_release.go | 触发 raglite 学习 |
| `crawler.callback` | Crawler（抓完） | mq/crawler.go | 把结果入库为 node |
| `cuc.sync` | API/定时器 | mq/cuc_sync.go | 同步组织架构 |
| `import.file` | API（上传） | mq/import.go | 解析 + 入库 |

## 配置参数

```yaml
# config.local.yml
mq:
  type: nats
  nats:
    server: 'nats://dev.localhost:13200'
    user: 'panda-wiki'
    password: 'panda_wiki_local_2025'
```

## 易错点

- ❌ 在 Consumer 内部消息处理里又同步等结果 → 应继续异步
- ❌ NATS 中止 / 重启没清队列 → 见 MEMORY 的"血泪教训"，手动中止要 3 步：purge NATS + restart raglite + 改 DB 状态
- ❌ NATS 没自动重连 → 已知问题，见 RAG 链路问题清单

## source_quote

```
backend/handler/mq/                  # 订阅处理器
backend/store/                       # NATS 客户端封装
backend/cmd/consumer/main.go         # 启动订阅
docker/dev/docker-compose.nats.yml   # 容器定义
```

## 关联

[[Backend API 进程]] · [[Backend Consumer 进程]] · [[Raglite]] · [[Crawler]]
