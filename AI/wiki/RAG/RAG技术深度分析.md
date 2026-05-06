# PandaWiki RAG 技术深度分析

> 本文档从代码路径和数据库层面深入分析 PandaWiki 的 RAG（Retrieval-Augmented Generation）技术实现。

## 目录

- [1. 架构概览](#1-架构概览)
- [2. 代码架构层面](#2-代码架构层面)
  - [2.1 核心目录结构](#21-核心目录结构)
  - [2.2 RAG 服务接口](#22-rag-服务接口)
  - [2.3 向量化处理流程](#23-向量化处理流程)
  - [2.4 检索处理流程](#24-检索处理流程)
- [3. 数据库层面](#3-数据库层面)
  - [3.1 关键数据表结构](#31-关键数据表结构)
  - [3.2 数据流转](#32-数据流转)
  - [3.3 核心数据库操作](#33-核心数据库操作)
- [4. 技术栈分析](#4-技术栈分析)
  - [4.1 RAG SDK](#41-rag-sdk)
  - [4.2 消息队列集成](#42-消息队列集成)
  - [4.3 权限控制集成](#43-权限控制集成)
- [5. 完整调用链路](#5-完整调用链路)
- [6. 配置管理](#6-配置管理)
- [7. 已知限制与注意事项](#7-已知限制与注意事项)

---

## 1. 架构概览

PandaWiki 的 RAG 系统采用**外部 RAG 服务 + 应用层编排**的架构模式：

```
┌─────────────────────────────────────────────────────────────────┐
│                        PandaWiki Backend                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────┐    ┌───────────┐    ┌───────────┐               │
│  │  Handler  │───▶│  Usecase  │───▶│   Store   │               │
│  │  (API/MQ) │    │  (LLM)    │    │   (RAG)   │               │
│  └───────────┘    └───────────┘    └─────┬─────┘               │
│                                          │                      │
│  ┌───────────┐    ┌───────────┐         │                      │
│  │   Repo    │◀───│  Domain   │◀────────┘                      │
│  │   (PG)    │    │  Models   │                                │
│  └───────────┘    └───────────┘                                │
└─────────────────────────────────────────────────────────────────┘
         │                                      │
         ▼                                      ▼
┌─────────────────┐                  ┌─────────────────┐
│   PostgreSQL    │                  │   CT-RAG 服务    │
│  (节点/权限)     │                  │  (向量存储/检索) │
└─────────────────┘                  └─────────────────┘
```

**核心特点：**
- 向量存储和检索由外部 CT-RAG 服务处理
- 应用层负责文档转换、权限控制、结果编排
- 异步消息队列处理向量化任务
- 支持多 RAG 服务提供商（通过接口抽象）

---

## 2. 代码架构层面

### 2.1 核心目录结构

```
backend/
├── store/rag/                          # RAG 存储层实现
│   ├── rag.go                         # RAG 服务工厂（支持多提供商）
│   └── ct/                            # CT-RAG 提供商实现
│       ├── rag.go                     # CT-RAG 核心实现
│       └── html2md.go                 # HTML 转 Markdown 转换器
│
├── usecase/
│   ├── llm.go                         # LLM usecase（包含 RAG 查询）
│   ├── chat.go                        # Chat usecase
│   └── model.go                       # 模型管理 usecase
│
├── handler/mq/
│   ├── rag.go                         # RAG 异步消息处理（upsert/delete）
│   └── rag_doc_update.go             # RAG 文档状态更新处理
│
├── repo/
│   ├── mq/rag.go                      # RAG 消息队列操作
│   └── pg/node.go                     # 节点数据库操作
│
├── domain/
│   ├── node.go                        # 节点领域模型（含 RagInfo）
│   └── mq.go                          # 消息队列常量和事件定义
│
└── consts/
    └── node.go                        # 节点常量（RAG 状态枚举）

sdk/rag/                               # RAG SDK 包
├── client.go                          # HTTP 客户端基础
├── models.go                          # 数据模型定义
├── retrieval.go                       # 检索接口
├── chunk.go                           # 分块操作
├── document.go                        # 文档操作
├── dataset.go                         # 数据集操作
└── model_config.go                    # 模型配置操作
```

### 2.2 RAG 服务接口

**文件路径：** `backend/store/rag/rag.go`

```go
type RAGService interface {
    // 知识库操作
    CreateKnowledgeBase(ctx context.Context) (string, error)
    DeleteKnowledgeBase(ctx context.Context, datasetID string) error

    // 文档操作
    UpsertRecords(ctx context.Context, datasetID string,
        nodeRelease *domain.NodeReleaseWithDirPath, authGroupId []int) (string, error)
    DeleteRecords(ctx context.Context, datasetID string, docIDs []string) error
    QueryRecords(ctx context.Context, datasetIDs []string, query string,
        groupIDs []int, similarityThreshold float64,
        historyMsgs []*schema.Message, documentIDs []string) ([]*domain.NodeContentChunk, error)

    // 权限管理
    UpdateDocumentGroupIDs(ctx context.Context, datasetID string,
        docID string, groupIds []int) error
    ListDocuments(ctx context.Context, datasetID string,
        params map[string]string) ([]rag.Document, error)

    // 模型管理
    GetModelList(ctx context.Context) ([]*domain.Model, error)
    AddModel(ctx context.Context, model *domain.Model) (string, error)
    UpdateModel(ctx context.Context, model *domain.Model) error
    DeleteModel(ctx context.Context, model *domain.Model) error
}
```

**当前实现：** CT-RAG (`backend/store/rag/ct/rag.go`)

| 方法 | 实现状态 | 说明 |
|------|---------|------|
| `UpsertRecords()` | ✅ 完整 | HTML→MD转换、文件上传、文档解析 |
| `QueryRecords()` | ✅ 完整 | 向量检索 + 应用层文档ID过滤 |
| `DeleteRecords()` | ✅ 完整 | 支持批量删除 |
| `UpdateDocumentGroupIDs()` | ⚠️ 不支持 | 当前SDK版本不支持，返回警告 |
| `ListDocuments()` | ✅ 完整 | 列出数据集中的文档 |

### 2.3 向量化处理流程

**触发方式：** 节点发布时通过消息队列异步处理

```
┌──────────────┐
│  节点发布     │
└──────┬───────┘
       │ 生成 NodeReleaseWithDirPath
       ▼
┌──────────────┐
│  发送 MQ 消息 │  VectorTaskTopic
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────┐
│  MQHandler (handler/mq/rag.go)                   │
│  ┌─────────────────────────────────────────────┐ │
│  │ 1. 获取 NodeRelease 信息                     │ │
│  │ 2. 获取权限组 IDs (answerable)               │ │
│  │ 3. 调用 RAGService.UpsertRecords()          │ │
│  └─────────────────────────────────────────────┘ │
└──────┬───────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────┐
│  CTRAG.UpsertRecords() (store/rag/ct/rag.go)     │
│  ┌─────────────────────────────────────────────┐ │
│  │ 1. HTML → Markdown 转换 (html2md.go)        │ │
│  │ 2. 创建临时 .md 文件                         │ │
│  │ 3. 调用 SDK: UploadDocumentsAndParse()      │ │
│  │ 4. 返回 doc_id                              │ │
│  └─────────────────────────────────────────────┘ │
└──────┬───────────────────────────────────────────┘
       │
       ▼
┌──────────────┐
│ 更新数据库    │  node_release.doc_id
│ rag_info     │  node.rag_info.status = BASIC_SUCCEEDED
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ RAG 服务回调  │  RagDocUpdateTopic
│ (增强处理)    │  更新 rag_info (分词/关键词等)
└──────────────┘
```

**关键代码：** `backend/store/rag/ct/rag.go:123-153`

```go
func (s *CTRAG) UpsertRecords(ctx context.Context, datasetID string,
    nodeRelease *domain.NodeReleaseWithDirPath, groupIds []int) (string, error) {

    // Step 1: 创建临时文件
    tempFile, err := os.CreateTemp("", fmt.Sprintf("%s-*.md", nodeRelease.ID))

    // Step 2: HTML/Markdown 转换
    markdown := nodeRelease.Content
    if utils.IsLikelyHTML(nodeRelease.Content) {
        markdown, err = s.mdConv.ConvertString(nodeRelease.Content)
    }

    // Step 3: 写入临时文件
    tempFile.Write([]byte(markdown))

    // Step 4: 调用 SDK 上传并解析
    docs, err := s.client.UploadDocumentsAndParse(ctx, datasetID, []string{tempFile.Name()})

    // Step 5: 返回第一个文档ID
    return docs[0].ID, nil
}
```

### 2.4 检索处理流程

**触发方式：** Chat 请求时同步调用

```
┌──────────────┐
│  Chat 请求    │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────┐
│  ChatUsecase.Chat()                               │
│  ┌─────────────────────────────────────────────┐ │
│  │ 1. 获取 App 配置                             │ │
│  │ 2. 获取 Chat 模型                            │ │
│  │ 3. 创建/获取对话                             │ │
│  │ 4. 调用 LLMUsecase.FormatConversationMessages│ │
│  └─────────────────────────────────────────────┘ │
└──────┬───────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────┐
│  LLMUsecase.FormatConversationMessages()          │
│  ┌─────────────────────────────────────────────┐ │
│  │ 1. 获取对话历史                              │ │
│  │ 2. 提取最后一条用户问题                       │ │
│  │ 3. 调用 GetRankNodes()                       │ │
│  └─────────────────────────────────────────────┘ │
└──────┬───────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────┐
│  LLMUsecase.GetRankNodes() (usecase/llm.go:320)   │
│  ┌─────────────────────────────────────────────┐ │
│  │ 1. RAGService.QueryRecords()                 │ │
│  │    - datasetIDs: 知识库数据集ID列表          │ │
│  │    - question: 用户问题                      │ │
│  │    - groupIDs: 权限组ID列表                  │ │
│  │    - documentIDs: 指定文档ID列表（可选）      │ │
│  │ 2. GetNodeReleasesWithPathsByDocIDs()        │ │
│  │    - doc_id → NodeRelease 映射               │ │
│  │ 3. 按 NodeID 去重                            │ │
│  │ 4. 返回 RankedNodeChunks[]                   │ │
│  └─────────────────────────────────────────────┘ │
└──────┬───────────────────────────────────────────┘
       │
       ▼
┌──────────────┐
│ 格式化文档    │  构建 Documents 文本
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 调用 LLM     │  system + history + documents
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 流式响应     │  SSE 事件
└──────────────┘
```

**关键代码：** `backend/usecase/llm.go:320-371`

```go
func (u *LLMUsecase) GetRankNodes(ctx context.Context,
    datasetIDs []string,
    question string,
    groupIDs []int,
    similarityThreshold float64,
    historyMessages []*schema.Message,
    documentIDs []string,
) ([]*domain.RankedNodeChunks, error) {

    // Step 1: RAG 向量检索
    records, err := u.rag.QueryRecords(ctx, datasetIDs, question, groupIDs,
        similarityThreshold, historyMessages, documentIDs)

    // Step 2: 获取 doc_id 对应的 NodeRelease
    docIDNode, err := u.nodeRepo.GetNodeReleasesWithPathsByDocIDs(ctx, docIDs)

    // Step 3: 按 NodeID 去重（支持同一节点多版本）
    rankedNodesMap := make(map[string]*domain.RankedNodeChunks)
    for _, record := range records {
        docNode := docIDNode[record.DocID]
        if _, exists := rankedNodesMap[docNode.NodeID]; !exists {
            rankedNodesMap[docNode.NodeID] = &domain.RankedNodeChunks{
                NodeID:    docNode.NodeID,
                Name:      docNode.Name,
                PathNames: docNode.PathNames,
                Chunks:    []*domain.NodeContentChunk{},
            }
        }
        rankedNodesMap[docNode.NodeID].Chunks = append(
            rankedNodesMap[docNode.NodeID].Chunks, record)
    }

    return rankedNodes, nil
}
```

---

## 3. 数据库层面

### 3.1 关键数据表结构

#### nodes 表

**迁移文件：** `000001_init.up.sql`

```sql
CREATE TABLE "public"."nodes" (
    "id" text PRIMARY KEY,
    "kb_id" text,                    -- 知识库ID
    "doc_id" text,                   -- RAG 服务返回的文档ID
    "type" smallint,                 -- 节点类型 (1=文件夹, 2=文档)
    "name" text,
    "content" text,                  -- 节点内容（HTML 或 Markdown）
    "meta" jsonb,                    -- 节点元数据
    "rag_info" jsonb,               -- RAG 处理状态信息
    "parent_id" text,
    "position" float,
    "created_at" timestamptz,
    "updated_at" timestamptz
);
```

**关键字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `doc_id` | text | 与 RAG 数据集中的文档 ID 映射 |
| `meta` | jsonb | 包含 `content_type` 区分 HTML/Markdown |
| `rag_info` | jsonb | RAG 处理状态和消息 |

#### node_releases 表

```sql
CREATE TABLE "public"."node_releases" (
    "id" text PRIMARY KEY,           -- 版本ID
    "node_id" text,                  -- 关联的节点ID
    "kb_id" text,
    "doc_id" text,                   -- RAG 服务的文档ID
    "type" smallint,
    "name" text,
    "content" text,                  -- 发布时的内容快照
    "meta" jsonb,
    "created_at" timestamptz,
    "updated_at" timestamptz
);
```

#### 权限相关表

```sql
-- node_auth_groups: 节点与权限组关联
CREATE TABLE "public"."node_auth_groups" (
    "id" serial,
    "node_id" text,
    "auth_group_id" int,
    "perm" text,                     -- 权限类型: answerable/visitable/visible
    "created_at" timestamptz
);

-- node_auth_users: 节点与用户直接授权关联
-- 迁移文件: 000037_create_node_auth_users.up.sql
CREATE TABLE "public"."node_auth_users" (
    "id" serial PRIMARY KEY,
    "node_id" text NOT NULL,
    "user_id" int NOT NULL,
    "perm" text NOT NULL,            -- 权限类型
    "created_at" timestamptz DEFAULT now()
);
```

#### rag_info 字段结构

**定义文件：** `backend/domain/node.go`

```go
type RagInfo struct {
    Status  NodeRagInfoStatus `json:"status"`   // 处理状态
    Message string            `json:"message"`  // 处理消息
}
```

**状态枚举：** `backend/consts/node.go`

```go
const (
    // 基础处理阶段
    NodeRagInfoStatusBasicPending   = "BASIC_PENDING"
    NodeRagInfoStatusBasicRunning   = "BASIC_RUNNING"
    NodeRagInfoStatusBasicSucceeded = "BASIC_SUCCEEDED"
    NodeRagInfoStatusBasicFailed    = "BASIC_FAILED"

    // 增强处理阶段（分词、关键词提取等）
    NodeRagInfoStatusEnhancePending   = "ENHANCE_PENDING"
    NodeRagInfoStatusEnhanceRunning   = "ENHANCE_RUNNING"
    NodeRagInfoStatusEnhanceSucceeded = "ENHANCE_SUCCEEDED"
    NodeRagInfoStatusEnhanceFailed    = "ENHANCE_FAILED"
)
```

### 3.2 数据流转

```
┌─────────────────────────────────────────────────────────────────┐
│                        数据流转示意图                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────┐     ┌───────────────┐     ┌───────────────┐     │
│  │  nodes    │────▶│ node_releases │────▶│  RAG 服务      │     │
│  │           │     │               │     │               │     │
│  │ content   │     │ content       │     │ 向量化存储    │     │
│  │ rag_info  │◀────│ doc_id        │◀────│ 返回 doc_id   │     │
│  └───────────┘     └───────────────┘     └───────────────┘     │
│       │                                         │               │
│       │              ┌──────────────┐           │               │
│       └─────────────▶│ 权限表        │◀──────────┘               │
│                      │ auth_groups  │   检索时过滤              │
│                      │ auth_users   │                          │
│                      └──────────────┘                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**节点更新时的数据库更新流程：**

1. **发布新版本** → 创建 `node_release` 记录
2. **触发 RAG 向量化** → 发送 MQ 消息，更新 `rag_info.status = BASIC_RUNNING`
3. **RAG 处理完成** → 更新 `node_release.doc_id`，`rag_info.status = BASIC_SUCCEEDED`
4. **RAG 增强处理回调** → 更新 `node.rag_info`（分词、关键词等）

### 3.3 核心数据库操作

**文件路径：** `backend/repo/pg/node.go`

#### 通过 Doc ID 获取节点信息

```go
// 第 502-514 行
func (r *NodeRepository) GetNodeReleasesByDocIDs(ctx context.Context,
    ids []string) (map[string]*domain.NodeRelease, error) {

    var releases []*domain.NodeRelease
    err := r.db.WithContext(ctx).
        Where("doc_id IN ?", ids).
        Find(&releases).Error

    result := make(map[string]*domain.NodeRelease)
    for _, release := range releases {
        result[release.DocID] = release
    }
    return result, nil
}
```

#### 获取节点路径信息

```go
// 第 525-579 行
func (r *NodeRepository) GetNodeReleasesWithPathsByDocIDs(ctx context.Context,
    ids []string) (map[string]*NodeReleaseWithPath, error) {

    // Step 1: 查询节点基本信息
    releases, err := r.GetNodeReleasesByDocIDs(ctx, ids)

    // Step 2: 批量查询节点路径
    paths, err := r.getNodePathsBatch(ctx, docIDs)

    // Step 3: 组装 PathNames
    result := make(map[string]*NodeReleaseWithPath)
    for docID, release := range releases {
        result[docID] = &NodeReleaseWithPath{
            NodeRelease: release,
            PathNames:   paths[docID].Names,
        }
    }
    return result, nil
}
```

#### 获取节点权限组

```go
// 第 64 行
func (r *NodeRepository) GetNodeAuthGroupIdsByNodeId(ctx context.Context,
    nodeID string, perm string) ([]int, error) {

    var groupIds []int
    err := r.db.WithContext(ctx).
        Model(&domain.NodeAuthGroup{}).
        Where("node_id = ? AND perm = ?", nodeID, perm).
        Pluck("auth_group_id", &groupIds).Error

    return groupIds, err
}
```

---

## 4. 技术栈分析

### 4.1 RAG SDK

**目录：** `sdk/rag/`

| 文件 | 用途 | 关键函数 |
|------|------|---------|
| `client.go` | HTTP 客户端基础 | `New()`, `newRequest()`, `do()` |
| `models.go` | 数据模型定义 | `RetrievalRequest`, `Dataset`, `Document` 等 |
| `retrieval.go` | 检索接口 | `RetrieveChunks()`, `RelatedQuestions()` |
| `chunk.go` | 分块操作 | `AddChunk()`, `ListChunks()`, `DeleteChunks()` |
| `document.go` | 文档操作 | `UploadDocuments()`, `UploadDocumentsAndParse()` |
| `dataset.go` | 数据集操作 | `CreateDataset()`, `DeleteDatasets()` |
| `model_config.go` | 模型配置 | `AddModelConfig()`, `GetModelConfigList()` |

#### 检索请求结构

```go
// sdk/rag/models.go
type RetrievalRequest struct {
    DatasetIDs          []string `json:"dataset_ids"`
    Question            string   `json:"question"`
    GroupIDs            []int    `json:"group_ids,omitempty"`
    DocumentIDs         []string `json:"document_ids,omitempty"`
    SimilarityThreshold float64  `json:"similarity_threshold,omitempty"`
}

type RetrievalChunk struct {
    ID         string  `json:"id"`
    DocID      string  `json:"doc_id"`
    Content    string  `json:"content"`
    Score      float64 `json:"score"`
    DocumentID string  `json:"document_id"`
}
```

### 4.2 消息队列集成

**消息队列：** NATS

#### 消息定义

**文件：** `backend/domain/mq.go`

```go
const (
    // 向量化任务主题
    VectorTaskTopic = "apps.panda-wiki.vector.task"

    // RAG 文档状态更新主题
    RagDocUpdateTopic = "rag.doc.update"
)

// 向量化任务请求
type NodeContentVectorRequest struct {
    KBID   string `json:"kb_id"`    // 知识库ID
    ID     string `json:"id"`       // node_release ID
    Action string `json:"action"`   // "upsert" 或 "delete"
}

// 文档状态更新事件（从 RAG 服务回调）
type RagDocInfoUpdateEvent struct {
    ID      string `json:"id"`      // 文档ID
    Status  string `json:"status"`  // 处理状态
    Message string `json:"message"` // 处理信息
}
```

#### MQ Handler

**文件：** `backend/handler/mq/rag.go`

```go
func (h *RAGMQHandler) HandleVectorTask(ctx context.Context,
    msg *domain.NodeContentVectorRequest) error {

    switch msg.Action {
    case "upsert":
        // 1. 获取 NodeRelease
        nodeRelease, _ := h.nodeRepo.GetNodeReleaseByID(ctx, msg.ID)

        // 2. 获取权限组
        groupIds, _ := h.nodeRepo.GetNodeAuthGroupIdsByNodeId(ctx,
            nodeRelease.NodeID, "answerable")

        // 3. 调用 RAG 服务
        docID, _ := h.rag.UpsertRecords(ctx, datasetID, nodeRelease, groupIds)

        // 4. 更新 doc_id
        h.nodeRepo.UpdateNodeReleaseDocID(ctx, msg.ID, docID)

    case "delete":
        h.rag.DeleteRecords(ctx, datasetID, []string{msg.DocID})
    }

    return nil
}
```

### 4.3 权限控制集成

#### 权限组 IDs 传递流程

```
┌─────────────────┐
│ 节点发布        │
└────────┬────────┘
         │ GetNodeAuthGroupIdsByNodeId(nodeID, "answerable")
         ▼
┌─────────────────┐
│ 获取权限组 IDs  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ RAG 向量化      │  UpsertRecords(datasetID, nodeRelease, groupIds)
└────────┬────────┘
         │ multipart 中包含 group_ids
         ▼
┌─────────────────┐
│ RAG 服务存储    │  文档关联权限组
└─────────────────┘
```

#### 检索时权限过滤

```go
// usecase/llm.go
func (u *LLMUsecase) GetRankNodes(ctx context.Context, ..., groupIDs []int, ...) {
    // groupIDs 传递给 RAG 服务进行过滤
    records, err := u.rag.QueryRecords(ctx, datasetIDs, question, groupIDs, ...)
}
```

**注意：** 当前 SDK 版本的权限过滤可能不完全，应用层可能需要补充过滤逻辑。

---

## 5. 完整调用链路

### Chat 场景完整链路

```
Frontend Chat Request
    │
    ▼
[API Layer]
api/xxx/chat
    │
    ▼
[Usecase Layer]
ChatUsecase.Chat()
    ├── 获取 App 配置
    ├── 获取 Chat 模型
    ├── 创建/获取对话
    └── LLMUsecase.FormatConversationMessages()
            │
            ├── 获取对话历史
            ├── 提取最后问题
            └── LLMUsecase.GetRankNodes()
                    │
                    ├── RAGService.QueryRecords()
                    │       │
                    │       └── CTRAG.QueryRecords()
                    │               ├── client.RetrieveChunks()
                    │               ├── 应用层文档 ID 过滤
                    │               └── 返回 NodeContentChunk[]
                    │
                    ├── NodeRepository.GetNodeReleasesWithPathsByDocIDs()
                    │       └── doc_id → NodeRelease 映射
                    │
                    └── 返回 RankedNodeChunks[]
            │
            ▼
格式化 Documents 文本
    │
    ▼
构建消息列表
    ├── System Prompt
    ├── History Messages
    └── Documents Context
    │
    ▼
[LLM Layer]
LLMUsecase.ChatWithAgent()
    ├── 调用 ChatModel.Stream()
    ├── 流式处理响应
    └── 发送 SSE 事件
    │
    ▼
Frontend 渲染响应
```

---

## 6. 配置管理

**配置文件：** `backend/config/config.local.yml`

```yaml
rag:
  provider: ct                                    # RAG 提供商
  ct_rag:
    base_url: 'http://dev.localhost:13400/api/v1' # RAG 服务地址
    api_key: 'sk-1234567890'                      # RAG API 密钥

# 相关配置
wiki_base_url: 'http://dev.localhost:3010'        # 用于生成文档链接
```

**环境变量：** `docker/.env`

```bash
RAG_PROVIDER=ct
CT_RAG_BASE_URL=http://ct-rag:8080/api/v1
CT_RAG_API_KEY=sk-xxxxx
```

---

## 7. 已知限制与注意事项

### 7.1 当前 RAG SDK 版本限制

| 限制 | 说明 | 代码位置 |
|------|------|---------|
| 文档 ID 过滤不完全 | 应用层需额外过滤 | `ct/rag.go:89-110` |
| 聊天历史上下文不支持 | `historyMsgs` 参数预留但未使用 | `ct/rag.go` |
| 权限组更新不支持 | `UpdateDocumentGroupIDs()` 返回警告 | `ct/rag.go:239-244` |

### 7.2 应用层文档 ID 过滤

**背景：** RAG 服务的 `document_ids` 参数可能不被正确处理

**解决方案：** `backend/store/rag/ct/rag.go:89-110`

```go
func (s *CTRAG) QueryRecords(ctx context.Context, ..., documentIDs []string) {
    // RAG 服务检索
    chunks, err := s.client.RetrieveChunks(ctx, req)

    // 应用层补充过滤
    if len(documentIDs) > 0 {
        docIDSet := make(map[string]struct{})
        for _, id := range documentIDs {
            docIDSet[id] = struct{}{}
        }

        filtered := make([]*domain.NodeContentChunk, 0)
        for _, chunk := range chunks {
            if _, ok := docIDSet[chunk.DocID]; ok {
                filtered = append(filtered, chunk)
            }
        }
        return filtered, nil
    }

    return chunks, nil
}
```

### 7.3 性能优化建议

1. **批量查询优化**
   - 使用 `getNodePathsBatch()` 而非单条循环查询
   - 位置：`repo/pg/node.go`

2. **去重策略**
   - 按 NodeID 去重而非 DocID（支持同一节点多版本）
   - 位置：`usecase/llm.go`

3. **缓存机制**
   - 知识库信息缓存（kbCache）
   - 权限信息缓存

### 7.4 扩展建议

1. **支持多 RAG 提供商**
   - 已有接口抽象，可添加新的实现（如 Milvus、Pinecone）

2. **增强检索能力**
   - 支持混合检索（向量 + 关键词）
   - 支持重排序（Reranker）

3. **权限控制增强**
   - 实现文档级别的实时权限更新
   - 支持更细粒度的权限控制

---

## 附录：关键文件索引

| 功能 | 文件路径 | 关键行号 |
|------|---------|---------|
| RAG 服务接口 | `backend/store/rag/rag.go` | - |
| CT-RAG 实现 | `backend/store/rag/ct/rag.go` | 123-153, 89-110 |
| HTML→MD 转换 | `backend/store/rag/ct/html2md.go` | - |
| RAG 检索调用 | `backend/usecase/llm.go` | 320-371 |
| MQ 向量化处理 | `backend/handler/mq/rag.go` | 47+ |
| 节点数据库操作 | `backend/repo/pg/node.go` | 502-599 |
| RAG 状态常量 | `backend/consts/node.go` | - |
| 领域模型定义 | `backend/domain/node.go` | - |
| MQ 消息定义 | `backend/domain/mq.go` | - |
| RAG SDK | `sdk/rag/` | - |
