---
title: Qdrant
tags:
  - pandawiki
  - 学习/阶段0
  - 服务
  - AI
  - 存储
aliases:
  - 向量数据库
  - 向量库
created: '2026-04-25'
sources:
  - docker/dev/docker-compose.qdrant.yml
---
# Qdrant

> 开源向量数据库。**PandaWiki Backend 不直接访问它**，只有 [[Raglite]] 在用。

## 基本信息

- **容器**：`panda-wiki-qdrant`
- **端口**：`dev.localhost:13701`
- **使用者**：仅 [[Raglite]]

## 存什么

每篇文档被切成多个 **chunk**，每个 chunk 经 [[Ollama]]（`bge-m3` 模型）算出一个向量（1024 维），存到 Qdrant：

```
chunk_id  →  [0.123, -0.456, ..., 0.789]  +  payload (kb_id, node_id, text)
```

## 检索流程

```
用户提问（文本）
   ↓
Ollama embedding → 查询向量
   ↓
Qdrant.search(query_vec, top_k=5)
   ↓
返回 top_k 个最相似 chunk 的 payload（含原文）
```

## 与 PostgreSQL 的分工

| | PG | Qdrant |
|---|---|---|
| 存 | 文档元数据（标题、归属、权限） | 文档 chunk 的向量 |
| 查 | "这个 kb 下有哪些 node" | "和这段查询最相似的 chunk" |
| 数据丢了 | 用户骂街 | 重新学习一次能恢复 |

## 易错点

- ❌ 以为 PandaWiki 直接连 Qdrant：实际经由 raglite
- ❌ 把 Qdrant 当通用数据库：它只擅长向量相似度

## source_quote

```
docker/dev/docker-compose.qdrant.yml   # 容器定义
docker/dev/docker-compose.raglite.yml  # raglite 通过环境变量连 qdrant
```

## 关联

[[Raglite]] · [[Ollama]] · [[存储边界规则]]
