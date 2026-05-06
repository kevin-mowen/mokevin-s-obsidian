---
title: Redis
tags:
  - pandawiki
  - 学习/阶段0
  - 服务
  - 存储
aliases:
  - 缓存
  - session存储
created: '2026-04-25'
sources:
  - backend/repo/cache/
  - docker/dev/docker-compose.redis.yml
---
# Redis

> 缓存 + 会话存储。**可丢失的高速读**。

## 基本信息

- **容器**：`panda-wiki-redis`
- **端口**：`dev.localhost:13500`
- **密码**：`panda_wiki_local_2025`

## 它存什么

| 类别 | 用途 |
|---|---|
| JWT session | 用户登录态 |
| 频控 | 限制同 IP 的接口调用速率 |
| 热点缓存 | 频繁读、变化少的数据（如知识库配置、模型配置） |
| 分布式锁 | 防止并发重复执行任务 |
| 验证码 | 短期有效 |

## 它不存什么

- ❌ 业务实体（用户表/文档表）→ [[PostgreSQL]]
- ❌ 文件 → [[MinIO]]

## 边界规则

判断"该用 PG 还是 Redis"：

> **丢了用户也无感、要快** → Redis；**丢了用户骂街** → PG

## 连接参数

```yaml
# config.local.yml
redis:
  addr: 'dev.localhost:13500'
  password: 'panda_wiki_local_2025'
```

## source_quote

```
backend/repo/cache/                  # Redis 仓储实现
docker/dev/docker-compose.redis.yml  # 容器定义
```

## 关联

[[存储边界规则]] · [[PostgreSQL]] · [[MinIO]]
