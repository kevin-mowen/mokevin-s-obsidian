# PandaWiki 模型配置说明

## 功能描述

PandaWiki 通过 RAGLite 服务管理多种类型的 AI 模型，不同模型在不同业务场景中使用。管理后台入口：系统配置 → 模型配置。

## 模型类型与用途

### 1. chat - 智能对话模型（大模型）

| 项目 | 说明 |
|------|------|
| 用途 | 智能问答 |
| 使用场景 | 用户在前台提问时，基于检索到的文档片段生成回答 |
| 当前模型 | glm-5.1（智谱） |
| 接入方式 | OneAPI → 智谱 API |
| API 地址 | `http://host.docker.internal:3002/v1` |
| temperature | 0.1 |

### 2. embedding - 向量模型（小模型）

| 项目 | 说明 |
|------|------|
| 用途 | 文档向量化 |
| 使用场景 | 重新学习时将文档分块并转为向量；智能问答时将用户问题转为向量 |
| 当前模型 | BAAI/bge-m3 |
| 接入方式 | router.tumuer.me 代理 |
| API 地址 | `https://router.tumuer.me/v1` |
| 向量维度 | 1024 |

### 3. rerank - 重排序模型（小模型）

| 项目 | 说明 |
|------|------|
| 用途 | 搜索结果重排序 |
| 使用场景 | 重新学习增强阶段和智能问答时，对检索到的文档片段进行相关性重排序 |
| 当前模型 | Qwen/Qwen3-Reranker-8B |
| 接入方式 | router.tumuer.me 代理 |
| API 地址 | `https://router.tumuer.me/v1` |

### 4. analysis - 内容分析模型（文本分析模型）

| 项目 | 说明 |
|------|------|
| 用途 | 文档内容分析、摘要提取 |
| 使用场景 | 重新学习增强阶段，分析文档内容生成摘要和关键信息 |
| 当前模型 | glm-5.1（智谱） |
| 接入方式 | OneAPI → 智谱 API |
| API 地址 | `http://host.docker.internal:3002/v1` |
| temperature | 0.1 |

### 5. analysis-vl - 图文分析模型（视觉语言模型）

| 项目 | 说明 |
|------|------|
| 用途 | 图片内容识别与分析 |
| 使用场景 | 文档中包含图片时，识别图片内容并生成文字描述 |
| 当前模型 | qwen-vl-max-latest（通义千问） |
| 接入方式 | 百知云 |
| API 地址 | `https://model-square.app.baizhi.cloud/v1` |

## 重新学习完整流程

用户点击"重新学习"后，完整流程分为 **5 个阶段**，由不同服务和模型协作完成：

### 阶段 1: 触发与排队

```
用户点击"重新学习" → API 服务（handler/v1/node.go:405）
                    → 设置状态为 RUNNING
                    → 发送 NATS 消息到 apps.panda-wiki.vector.task
```

- 涉及文件：`handler/v1/node.go`、`usecase/node.go:879-921`、`repo/mq/rag.go:32-50`
- 不使用任何模型

### 阶段 2: Consumer 消费消息 + 内容预处理

```
Consumer 服务收到 NATS 消息 → 从数据库获取文档内容
                            → 删除旧版本文档（防重复）
                            → 内容格式转换
```

- 涉及文件：`handler/mq/rag.go:49-229`、`store/rag/ct.go:100-162`
- 内容转换：Excel JSON → Markdown 表格、HTML → Markdown、宽表格 → 竖排格式
- 不使用任何模型

### 阶段 3: RAGLite 基础处理（BASIC_PENDING → BASIC_RUNNING）

```
Consumer 上传文档到 RAGLite → RAGLite 内部处理：
                              ① 文本分块（Chunking）
                              ② 向量生成（Embedding）
                              ③ 向量存储
```

- 使用模型：**embedding 模型**（BAAI/bge-m3）
- 状态变化：BASIC_PENDING → BASIC_RUNNING → 完成

### 阶段 4: RAGLite 增强处理（ENHANCE_RUNNING）

```
基础处理完成后 → RAGLite 自动进入增强阶段：
                 ① 文档片段重排序（Rerank）
                 ② 摘要生成（Summary）
```

- 使用模型：
  - **rerank 模型**（Qwen/Qwen3-Reranker-8B）— 对分块结果重排序
  - **analysis 模型**（glm-5.1）— 生成文档摘要
- 状态变化：ENHANCE_RUNNING → ENHANCE_SUCCEEDED / ENHANCE_FAILED

### 阶段 5: 状态回写

```
RAGLite 处理完成 → 发送事件到 raglite.events.doc.update
                 → Consumer 接收并更新数据库中的文档状态
```

- 涉及文件：`handler/mq/rag_doc_update.go:34-78`
- 不使用任何模型

### 状态流转总览

```
RUNNING → BASIC_PENDING → BASIC_RUNNING → ENHANCE_RUNNING → ENHANCE_SUCCEEDED
                                                           → ENHANCE_FAILED
失败时 → FAILED（重试 5 次后）
```

### 各阶段模型使用汇总

| 阶段 | 模型类型 | 当前模型 | 用途 |
|------|---------|---------|------|
| 基础处理 | embedding | BAAI/bge-m3 | 文本分块后生成向量 |
| 增强处理 | rerank | Qwen/Qwen3-Reranker-8B | 文档片段相关性重排序 |
| 增强处理 | analysis | glm-5.1 | 生成文档摘要 |
| 增强处理（有图片时） | analysis-vl | qwen-vl-max-latest | 图片内容识别 |

> **注意**：chat 模型在重新学习中**不参与**，仅在用户发起智能问答时使用。

## 智能问答（Chat）流程

```
用户提问 → embedding模型(bge-m3) → 问题向量化
        → 向量检索 → 召回相关文档片段
        → rerank模型(Qwen3-Reranker) → 重排序
        → chat模型(glm-5.1) → 生成回答
```

## 检测模型（CheckModel）流程

```
管理后台点击检测 → PandaWiki后端 → ModelKit库 → 目标LLM服务
                   （handler层）    （v2.13.3）
```

## 架构说明

### 配置存储

模型配置存储在**两个地方**，保存/切换模型时自动同步：

1. **PandaWiki 数据库** — 管理后台展示和编辑用
2. **RAGLite 服务** — 实际调用模型时使用（通过 `store/rag/ct.go` 的 `UpsertModel/UpdateModel` 同步）

### 关键文件索引

| 组件 | 文件路径 | 说明 |
|------|---------|------|
| 重新学习 API | `handler/v1/node.go:405` | 触发入口 |
| 重新学习逻辑 | `usecase/node.go:879-921` | 排队和状态管理 |
| NATS 消息发送 | `repo/mq/rag.go:32-50` | 发布向量任务 |
| Consumer 处理 | `handler/mq/rag.go:49-229` | 消费消息、上传文档 |
| RAGLite 交互 | `store/rag/ct.go:100-162` | 内容预处理、上传 |
| 状态回调 | `handler/mq/rag_doc_update.go:34-78` | RAGLite 事件处理 |
| 模型同步 | `store/rag/ct.go:205-289` | AddModel/UpsertModel/UpdateModel |
| 模型类型常量 | `domain/model.go:19-27` | 类型定义 |

### 网络架构（本地开发环境）

```
本地服务（go run）             Docker 容器
┌─────────────┐              ┌──────────────────┐
│ API (18000)  │──────────── │ RAGLite (13400)   │
│ Consumer     │              │                  │
│ Admin (3000) │              │ OneAPI (3002)     │
│ App (3010)   │              │ PostgreSQL        │
└─────────────┘              │ Redis / MinIO     │
                              └──────────────────┘
```

- 本地服务访问 OneAPI：通过 `host.docker.internal:3002`（需 hosts 配置）
- RAGLite 容器访问 OneAPI：通过 `host.docker.internal:3002`（Docker 内置解析）
- RAGLite API 查询地址：`http://dev.localhost:13400/api/v1/models`

## 注意事项

- **temperature 参数**: 某些 LLM 服务（如 OneAPI）不接受 temperature=0，系统默认兜底为 0.01
- **ModelKit 版本**: 需 v2.13.3 以上才能正确传递 temperature 参数（v2.12.4 有 bug）
- **网络地址**: Docker 容器内不能用 `localhost` 或 `dev.localhost` 访问宿主机服务，需用 `host.docker.internal`
- **macOS hosts 配置**: 本地开发需在 `/etc/hosts` 添加 `127.0.0.1 host.docker.internal`
- **重试机制**: 向量上传最多重试 5 次，旧文档删除最多重试 3 次（失败后降级为警告）

## 踩坑记录

### 问题 1: CheckModel 检测模型报 temperature=0 错误
- 原因: ModelKit v2.12.4 的 `getChatModelGenerateChat` 方法构建 `ModelMetadata` 时遗漏了 `req.Param.Temperature` 字段
- 解决: 升级 ModelKit 到 v2.13.3 + handler 层 temperature 兜底

### 问题 2: 重新学习时 OneAPI 没收到请求
- 原因: RAGLite 跑在 Docker 容器里，用 `dev.localhost` 无法访问宿主机的 OneAPI 服务
- 解决: 统一使用 `host.docker.internal:3002` 作为 OneAPI 地址

### 问题 3: 以为重新学习用 chat 模型，实际用 analysis 模型
- 原因: 重新学习的摘要生成用的是 analysis 类型模型，不是 chat 类型
- 解决: 管理后台需分别配置 chat（智能问答用）和 analysis（文本分析模型，重新学习用）

## 变更历史
- 2026-04-10: 升级 ModelKit v2.12.4 → v2.13.3，修复 temperature 传递问题
- 2026-04-10: 前端 ModelConfig.tsx 补充 temperature 参数传递
- 2026-04-10: 前端 @ctzhian/modelkit 升级 2.12.6 → 2.13.3
- 2026-04-10: 统一 OneAPI 接入地址为 host.docker.internal:3002
- 2026-04-10: 补充重新学习完整流程文档，明确各阶段模型使用
