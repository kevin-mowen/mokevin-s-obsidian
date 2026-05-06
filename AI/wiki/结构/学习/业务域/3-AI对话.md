---
title: 业务域 3　AI 对话
tags:
  - pandawiki
  - 学习/阶段0
  - 业务域
  - AI
aliases:
  - AI对话
  - chat域
created: '2026-04-25'
sources:
  - backend/domain/chat.go
  - backend/domain/conversation.go
  - backend/domain/llm.go
  - backend/domain/model.go
  - backend/usecase/chat.go
  - backend/usecase/llm.go
---
# 业务域 3　AI 对话

> PandaWiki 的"灵魂"。集成 RAG 检索 + LLM 生成 + 流式返回。

## 域内 domain 文件

| 文件 | 职责 |
|---|---|
| `chat.go` | 一次对话请求的 DTO（消息、流式 token） |
| `conversation.go` | 持久化的对话历史 |
| `llm.go` | 模型调用抽象（OpenAI 协议） |
| `model.go` | 模型元数据（名称、API Key、provider） |
| `prompt.go` | 提示词配置 |

## 主要 PG 表

```
conversations               一次对话会话
conversation_messages       消息流水（user/assistant/system）
models                      模型配置
prompts                     系统级提示词
```

## 关键流程

详见 [[AI 问答请求路径]]。

## 5 步（极简版）

1. App 发 `POST /share/chat/completions`（SSE）
2. handler/share/chat.go 接到
3. usecase/chat.go：
   - 查 PG 鉴权
   - 调 raglite 检索
   - 拼 prompt
   - 调 Ollama / one-api 生成
4. SSE 流式返回
5. 异步：发 NATS → Consumer 写 `conversation_messages`

## 已知问题

⚠️ **Chat 缺少节点级权限检查**（高优先级）：

- `usecase/chat.go` Chat 方法 (L77-230) 缺少个人权限检查
- 对比 Search 方法 (L444-497) 有完整检查
- `handler/share/chat.go:67` `/completions` 端点无 Authorize 中间件
- `usecase/llm.go` `FormatConversationMessages` (L60-142) 无权限验证
- `store/rag/ct/rag.go` (L49-52) RAG 服务不支持 groupIds 过滤

详见 MEMORY 的"智能问答权限绕过"。

## eino 框架

LLM 调用基于 [eino](https://github.com/cloudwego/eino) 框架，支持：
- OpenAI（含兼容协议如 one-api）
- DeepSeek / Gemini / Ollama
- Tool calling（计划中：[[agent-panel-design|AI Agent 问答面板]]）

## source_quote

```
backend/domain/chat.go               # ChatReq/ChatRes
backend/usecase/chat.go (18k)        # 主流程
backend/usecase/llm.go (17k)         # 模型调用
backend/handler/share/chat.go        # SSE 端点
backend/store/rag/ct/rag.go          # raglite 调用
```

## 关联

[[业务域总览]] · [[2-知识库与文档]] · [[Raglite]] · [[Ollama]] · [[AI 问答请求路径]]
