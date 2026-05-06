---
title: PostgreSQL
tags:
  - pandawiki
  - 学习/阶段0
  - 服务
  - 存储
aliases:
  - PG
  - Postgres
  - 主数据库
created: '2026-04-25'
sources:
  - backend/store/pg/
  - backend/store/pg/migration/
  - docker/dev/docker-compose.postgres.yml
---
# PostgreSQL

> **唯一的结构化数据权威来源**。所有字段、关系、约束都在它这里。

## 基本信息

- **容器**：`panda-wiki-postgres`
- **端口**：`dev.localhost:13100`
- **DB 名**：`panda-wiki`（带连字符）
- **用户**：`panda-wiki`
- **ORM**：GORM

## 它存什么

| 类别 | 表举例 | 数量 |
|---|---|---|
| 身份与权限 | `users`、`auth_groups`、`kb_users`、`api_tokens`、`system_api_tokens` | ~7 |
| 知识库与文档 | `knowledge_bases`、`nodes`、`node_releases`、`apps` | ~8 |
| AI 对话 | `conversations`、`conversation_messages`、`models`、`prompts` | ~6 |
| 内容接入 | `contributes`、`openapi_call_logs` | ~4 |
| 用户反馈 | `user_comment`、`document_feedback`、`stat_pages`、`stat_page_hours` | ~6 |
| 系统设施 | `license`、`settings`、`block_words`、`announcements` | ~6 |

共 51 张表（截至 migration 000051）。

## 它不存什么

- ❌ 文档原始文件 → [[MinIO]]
- ❌ 文档向量 → [[Qdrant]]
- ❌ Session / 缓存 → [[Redis]]

## migration 流水

`backend/store/pg/migration/` 目录下 51 份 `.up.sql` / `.down.sql` 配对。

```bash
cd backend
make migrate_sql SEQ_NAME=create_xxx   # 新增
```

编号递增、不可改已合并的。

## 连接参数

```yaml
# config.local.yml
pg:
  dsn: 'host=dev.localhost user=panda-wiki password=panda_wiki_local_2025 dbname=panda-wiki port=13100 sslmode=disable TimeZone=Asia/Shanghai'
```

## 易错点

- ❌ `dbname=pandawiki_dev` → 实际是 `panda-wiki`
- ❌ 用 `localhost` 而非 `dev.localhost`
- ❌ 想塞向量进来 → PG 不是向量库

## source_quote

```
backend/store/pg/                    # GORM 连接
backend/store/pg/migration/          # 51 份 DDL
backend/repo/pg/                     # 仓储实现
docker/dev/docker-compose.postgres.yml  # 容器定义
```

## 关联

[[存储边界规则]] · [[Redis]] · [[MinIO]] · [[后端分层]]
