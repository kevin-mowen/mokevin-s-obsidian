---
title: Raglite
tags:
  - pandawiki
  - 学习/阶段0
  - 服务
  - AI
  - RAG
aliases:
  - RAG服务
  - RAG引擎
created: '2026-04-25'
sources:
  - backend/store/rag/ct/
  - backend/config/config.go
  - docker/dev/docker-compose.raglite.yml
---
# Raglite

> 长亭自研的闭源 RAG 引擎（独立容器）。**PandaWiki 把所有 RAG 重活全部委托给它**。

## 基本信息

- **容器**：`panda-wiki-raglite`
- **端口**：`dev.localhost:13400`
- **SDK**：`chaitin/raglite-go-sdk v0.2.1`
- **当前版本**：v2.15.1

## 它做什么

| 阶段 | 动作 |
|---|---|
| **学习** | 接收 Backend 推过来的文档 → 切 chunk → 调 [[Ollama]] 算 embedding → 写 [[Qdrant]] |
| **检索** | 接收查询文本 → embedding → 查 Qdrant → 返回 top-k chunks |
| **元信息** | 在自己的 `raglite_v2` 库里维护文档/chunk/任务状态 |

## PandaWiki 怎么调它

```go
// backend/store/rag/ct/rag.go
client := raglite.NewClient(baseURL, apiKey)
client.AddDocument(...)   // 学习
client.Search(query, ...) // 检索
```

## v2.x 关键变化

`base_url` **不带** `/api/v1` 后缀（v1.x 时代的写法）：

```yaml
# 对 ✅
rag:
  ct_rag:
    base_url: 'http://dev.localhost:13400'

# 错 ❌
base_url: 'http://dev.localhost:13400/api/v1'
```

详见 `backend/config/config.go:155` 与 MEMORY 的"raglite v2.x 升级"。

## 已知瓶颈

- 单任务客户端硬编码 2 goroutine（闭源），不拆 document 就打不满 Ollama 并发槽位
- 大文档（10MB ~7249 chunks）学不完，详见 MEMORY 的"大文档 RAG 学习失败"
- 当前首选解决：方案 E（导入层按章节自动拆分 ~200 行）

## 它的内部模型配置

`raglite_v2.ai_models` 表配三组：
- `embedding`: `BAAI/bge-m3 @ http://host.docker.internal:11434/v1`
- `analysis`: `qwen2.5:7b @ http://host.docker.internal:11434/v1`
- `chat`: `glm-5.1 @ http://host.docker.internal:3002/v1`（one-api）

## source_quote

```
backend/store/rag/ct/rag.go            # SDK 调用封装
backend/config/config.go:155           # 默认 base_url
backend/config/config.local.yml:23     # dev 模式 base_url
docker/dev/docker-compose.raglite.yml  # 容器定义
```

## 关联

[[Qdrant]] · [[Ollama]] · [[Backend Consumer 进程]] · [[AI 问答请求路径]]
