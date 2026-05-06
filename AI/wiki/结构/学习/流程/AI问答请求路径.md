---
title: AI 问答请求路径
tags:
  - pandawiki
  - 学习/阶段0
  - 流程
  - AI
aliases:
  - AI问答路径
  - Chat请求流程
created: '2026-04-25'
sources:
  - backend/handler/share/chat.go
  - backend/usecase/chat.go
  - backend/store/rag/ct/rag.go
---
# AI 问答请求路径

> 一次"用户在前台问 AI"的端到端流程。把 [[五大子系统]] / [[业务域总览]] 串起来的最佳示例。

## 全链路图

```
① 用户在 App (localhost:3010) 输入"什么是 RAG？"
   │
   │ HTTPS POST /share/chat/completions  (SSE 流式)
   ▼
② Backend API (dev.localhost:18000)
   handler/share/chat.go:67 接到请求
   │
   ▼
③ usecase/chat.go 主流程：
   │
   │   a. 鉴权
   │      ┌──────► PG.users + auth_groups + kb_users
   │      └─ JWT 验签 → 取出 user_id → 检查 kb 权限
   │
   │   b. 检索
   │      ┌──────► Raglite (13400)
   │      │            │
   │      │            ├─► Ollama embed query "什么是 RAG？" → vec
   │      │            ├─► Qdrant.search(vec, top_k=5) → top-N chunks
   │      │            └─► 返回 chunks（含原文 + node_id）
   │      └─ 拿到检索结果
   │
   │   c. 组装 prompt
   │      ┌─ system_prompt（来自 prompts 表）
   │      ├─ 历史对话（来自 conversation_messages）
   │      ├─ 检索到的 chunks（"相关知识"段）
   │      └─ 用户问题
   │
   │   d. 调 LLM
   │      ┌──────► Ollama / one-api（chat 模型）
   │      │            └─► 流式返回 token
   │      └─ 边收边转给 App（SSE）
   │
   ▼
④ App 收到 SSE，逐字渲染气泡
   │
   ▼
⑤ 异步收尾：
   API 发 NATS 消息 → Consumer 写 conversation_messages 表
```

## 涉及的服务

| 服务 | 作用 |
|---|---|
| [[Admin 与 App 前端\|App]] | 发起请求、流式渲染 |
| [[Backend API 进程]] | 接 HTTP、鉴权、组装 prompt |
| [[PostgreSQL]] | 用户、权限、对话历史 |
| [[Raglite]] | 检索协调 |
| [[Qdrant]] | 向量相似度查询 |
| [[Ollama]] | embedding + chat |
| [[NATS]] | 异步写历史 |
| [[Backend Consumer 进程]] | 落库 |

## 关键认知

> **PandaWiki Backend 自己不算 embedding、不查向量、不调本地模型**。  
> **它只组合数据 + 调下游服务**。

## 易错点

- ❌ 以为 PG 存 embedding：在 [[Qdrant]]
- ❌ 以为 Backend 直连 Ollama：经 [[Raglite]] 中转
- ❌ 以为是同步：实际响应是 SSE 流，且写历史是异步

## 已知漏洞

⚠️ Chat 路径**缺少节点级权限检查**：

- `usecase/chat.go` Chat 方法 (L77-230) 没做个人权限过滤
- `handler/share/chat.go:67` 无 Authorize 中间件
- RAG 检索结果没在应用层做 group_ids 过滤

详见 [[1-身份与权限]] 与 MEMORY 的"智能问答权限绕过"。

## source_quote

```
backend/handler/share/chat.go        # SSE 端点
backend/usecase/chat.go (L77-230)    # 主流程
backend/usecase/llm.go (L60-142)     # FormatConversationMessages
backend/store/rag/ct/rag.go (L49-52) # raglite 调用
```

## 关联

[[3-AI对话]] · [[Raglite]] · [[Qdrant]] · [[Ollama]] · [[1-身份与权限]]
