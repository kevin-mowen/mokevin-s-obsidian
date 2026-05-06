---
tags:
  - 调研报告
  - RAG
  - OpenViking
  - PandaWiki
date: '2026-03-15'
status: completed
updated: '2026-03-15'
---
# PandaWiki 与 OpenViking RAG 结合调研报告

> 调研日期：2026-03-15
> 调研目的：评估使用 OpenViking 替换 PandaWiki RAG 层的可行性

---

## 一、PandaWiki 当前 RAG 架构

PandaWiki 是一套 AI 知识库 Wiki 系统，当前 RAG 问答链路如下：

```
文档发布 → NATS 消息队列 → Chaitin Turbo RAG（分块 + embedding）→ Qdrant 向量库
用户提问 → Chaitin RAG 检索 Qdrant（top-k）→ LLM 生成回答
```

**核心组件：**
- **Chaitin Turbo RAG**（raglite）：负责文档分块、embedding 生成、检索
- **Qdrant**：向量数据库，存储 embedding 索引
- **检索方式**：单层向量相似度 top-k，无目录感知，无分级加载

**数据存储：**
- 文档原文存储在 **PostgreSQL**（`nodes` 表 + `node_releases` 表），不在 MinIO
- MinIO 仅存文件附件（图片、PDF 原件等）
- RAGLite + Qdrant 只是**检索索引**，可从 PG 完全重建

**部署：** 共 12 个 Docker 容器，其中 qdrant 和 raglite 专为 RAG 服务。

---

## 二、OpenViking 项目介绍

OpenViking 是字节跳动/火山引擎开源的 **Context Database for AI Agents**，使用虚拟文件系统（`viking://` 协议）统一管理上下文。

**核心能力：**
- **三层分级上下文**：L0 摘要（~100 tokens）→ L1 概览（~2k tokens）→ L2 全文，按需加载
- **目录递归检索**：沿目录树逐层搜索，先粗后细，分数从父到子传播，自动收敛停止
- **嵌入式向量数据库**：C++ 引擎 + LevelDB 存储，单进程内运行，零外部依赖
- **用户记忆系统**：自动从对话中提取用户偏好、实体、事件，按用户隔离存储
- **Rerank 重排序 + 热度加权**：提升检索精度

**与传统 RAG 的核心区别：**

传统 RAG 是"全库扁平搜索"，OpenViking 是"沿目录树定向搜索"——先翻目录（L0），再翻章节（L1），最后读原文（L2），Token 消耗更低、检索更精准。

---

## 三、替换方案：OpenViking 替换 PandaWiki RAG 层

### 3.1 架构变化

```
替换前（12 个容器）：
  文档发布 → NATS → consumer → Chaitin RAG → Qdrant
  用户提问 → api → Chaitin RAG → Qdrant 检索 → LLM 回答

替换后（10 个容器 + openviking-server）：
  文档发布 → NATS → consumer → OpenViking HTTP API 入库
  用户提问 → api → OpenViking /search/find 检索 → LLM 回答
```

移除 `panda-wiki-qdrant` 和 `panda-wiki-raglite` 两个容器，由本地 `openviking-server`（端口 1933）替代。

### 3.2 需要改动的文件

| 文件 | 改动内容 |
|------|---------|
| `backend/store/rag/ct.go` | Chaitin RAG SDK → OpenViking HTTP Client，统一注入用户标识 Header |
| `backend/usecase/llm.go` | `GetRankNodes()` 改为调用 OpenViking search API |
| `backend/handler/mq/rag.go` | 文档入库/删除改为调用 OpenViking API |
| `backend/handler/share/chat.go` | 问答接口透传用户标识到 OpenViking |

### 3.3 数据迁移

RAG 索引需一次性重建，**不会丢失数据**：

```
第1步：PostgreSQL 保持不动（文档原文零风险）
第2步：移除 qdrant + raglite 容器
第3步：从 PG node_releases 表读取所有已发布文档
第4步：逐条调用 OpenViking API 重新入库（自动完成解析 + 向量化）
第5步：将返回的 viking:// URI 写回 node_releases.doc_id
```

替换过程**完全可逆**——如不满意，可重新部署 RAGLite + Qdrant 从 PG 重建索引。

### 3.4 注意事项

#### 一、用户标识必须正确透传（关键）

OpenViking 通过请求头识别用户，实现记忆按用户隔离。**如果不传，所有用户的记忆会混在一起。**

```
每次调用 OpenViking API 必须携带：
  X-OpenViking-Account: "{kb_id}"       ← 知识库 ID（数据隔离）
  X-OpenViking-User: "{user_id}"        ← 用户 ID（记忆隔离）
```

用户标识映射关系：

| OpenViking Header | 映射来源（PandaWiki） | 作用 |
|-------------------|---------------------|------|
| `X-OpenViking-Account` | 知识库 ID（`kb_id`） | 知识库间数据隔离 |
| `X-OpenViking-User` | 登录用户 ID | 用户间记忆隔离 |

匿名用户（未登录）应使用 `anon_{conversation_id}` 作为临时用户 ID，避免匿名用户间记忆污染。

#### 二、权限过滤需要 PandaWiki 侧处理

OpenViking 的权限模型（account/user 租户隔离）与 PandaWiki 的权限模型（auth_group 文档级分组权限）不同。

**建议：** 先用 PandaWiki 侧二次过滤——OpenViking 以 ROOT 角色返回全部结果，PandaWiki 根据用户的 auth_groups 过滤掉无权限的文档。后续可通过 `scope_dsl` 参数在向量检索阶段直接过滤。

#### 三、检索结果格式需要适配

PandaWiki 原来期望 RAGLite 返回 `doc_id` + 文档块，OpenViking 返回 `viking:// URI` + 分级内容（L0/L1/L2）。需要在 `GetRankNodes()` 中做格式转换。

#### 四、删除和重学功能需同步改造

- **删除文档**：原来调 RAGLite 删除，需改为调 OpenViking 删除 API
- **重学（Restudy）**：原来调 RAGLite 重新向量化，需改为调 OpenViking upsert 接口

#### 五、引入 Python 运行时

原来 PandaWiki 全栈是 Go + Node.js，引入 openviking-server 后多了一个 Python 进程。建议将 openviking-server 也 Docker 化，统一管理。

### 3.5 收益

| 收益 | 说明 |
|------|------|
| 部署简化 | 12 个容器 → 10 个容器 + 1 个本地进程 |
| 检索精度提升 | 三层分级递归检索 vs 单层 top-k |
| Token 成本降低 | L0 先筛后加载 L2，避免无关内容进入 LLM |
| 个性化问答 | 按用户隔离的记忆系统，不同用户获得个性化回答 |
| 目录结构保留 | 天然适配 Wiki 的层级文档结构 |
| 数据安全 | 文档原文在 PG 中不动，替换完全可逆 |

---

## 四、待进一步考虑的方向

以下方向在本次调研中未深入展开，后续可按需推进：

1. **pgvector 统一存储** — 当前 OpenViking 不支持 pgvector 后端，如需复用 PandaWiki 的 PG 实例存储向量，需要开发 `PgVectorCollection` 适配层
2. **scope_dsl 权限过滤** — 在向量检索阶段直接按 auth_groups 过滤，避免二次过滤浪费 top-k 名额
3. **OpenViking 作为上下文增强层** — 不替换原有 RAG，而是作为补充检索源，降低改造风险
4. **PandaWiki 作为 OpenViking 的 Web 前端** — 利用 Wiki 的前端和管理后台，给 OpenViking 加 Web UI
5. **性能基准测试** — 替换后的检索延迟、吞吐量、回答质量对比评测
6. **多知识库场景** — 多个知识库同时使用 OpenViking 时的资源隔离和性能影响
