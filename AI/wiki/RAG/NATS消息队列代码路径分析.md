# NATS 消息队列代码路径分析

## 概述

本文档分析 PandaWiki 中 NATS 消息队列的工作机制，以 `VectorTaskTopic`（向量化任务）为例，完整跟踪从服务启动到消息处理的代码路径。

## Topic 定义

**文件**: `backend/domain/mq.go`

```go
const (
    VectorTaskTopic       = "apps.panda-wiki.vector.task"
    AnydocTaskExportTopic = "anydoc.persistence.doc.task.export"
    RagDocUpdateTopic     = "rag.doc.update"
)

var TopicConsumerName = map[string]string{
    VectorTaskTopic:       "panda-wiki-vector-consumer",
    AnydocTaskExportTopic: "anydoc-task-export-consumer",
    RagDocUpdateTopic:     "rag-doc-update-consumer",
}
```

| 常量 | 字符串值 | 用途 |
|------|----------|------|
| `VectorTaskTopic` | `apps.panda-wiki.vector.task` | 向量化任务 - 用于触发文档的向量化处理（RAG 相关），支持 upsert/delete 操作 |
| `AnydocTaskExportTopic` | `anydoc.persistence.doc.task.export` | 文档导出任务 - anydoc 服务完成文档解析后的回调通知 |
| `RagDocUpdateTopic` | `rag.doc.update` | RAG 文档状态更新 - 通知文档处理状态变化 |

## 工作原理比喻

可以用**微信群聊**来理解 NATS 的发布/订阅机制：

```
NATS 服务器  =  微信服务器
Topic 字符串  =  群聊名称
Subscribe    =  加入群聊
Publish      =  在群里发消息
```

```
群名: "apps.panda-wiki.vector.task"

┌─────────────────────────────────────────────────────────┐
│                      微信群聊                            │
│            "apps.panda-wiki.vector.task"                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [文档服务] 发送消息: "请处理文档A的向量化"               │
│       ↓                                                 │
│  ┌─────────────────────────────────────────┐           │
│  │ 群成员（订阅者）都能收到:                  │           │
│  │  • [向量服务1] ✓ 收到                    │           │
│  │  • [向量服务2] ✓ 收到                    │           │
│  │  • [监控服务]  ✓ 收到                    │           │
│  └─────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

**关键点**：
- **Subscribe 在前**：服务启动时就订阅好了，一直在"听"
- **Publish 在后**：有任务时才发布消息
- Topic 字符串是约定好的，发送者和接收者必须用**同一个字符串**才能通信

---

## 完整代码路径

### 阶段一：服务启动 - 订阅（Subscribe）

```
cmd/consumer/wire_gen.go:49
         ↓
NewRAGMQHandler(mqConsumer, ...)
         ↓
handler/mq/rag.go:32
consumer.RegisterHandler(domain.VectorTaskTopic, h.HandleNodeContentVectorRequest)
         ↓
mq/nats/consumer.go:107
c.js.Subscribe("apps.panda-wiki.vector.task", handler)
         ↓
✅ 向量服务开始监听，等待任务
```

#### 1.1 Wire 依赖注入启动

**文件**: `backend/cmd/consumer/wire_gen.go:49`

```go
ragmqHandler, err := mq2.NewRAGMQHandler(mqConsumer, logger, ragService, nodeRepository, knowledgeBaseRepository)
```

#### 1.2 创建 Handler 并注册

**文件**: `backend/handler/mq/rag.go:24-35`

```go
func NewRAGMQHandler(consumer mq.MQConsumer, logger *log.Logger, rag rag.RAGService, nodeRepo *pg.NodeRepository, kbRepo *pg.KnowledgeBaseRepository) (*RAGMQHandler, error) {
    h := &RAGMQHandler{
        consumer: consumer,
        logger:   logger.WithModule("mq.vector"),
        rag:      rag,
        nodeRepo: nodeRepo,
        kbRepo:   kbRepo,
    }
    // 注册消息处理器
    if err := consumer.RegisterHandler(domain.VectorTaskTopic, h.HandleNodeContentVectorRequest); err != nil {
        return nil, err
    }
    return h, nil
}
```

#### 1.3 NATS 订阅

**文件**: `backend/mq/nats/consumer.go:96-134`

```go
func (c *MQConsumer) registerJetStreamHandler(topic string, handler func(ctx context.Context, msg types.Message) error) error {
    consumerName := domain.TopicConsumerName[topic]

    sub, err := c.js.Subscribe(topic, func(msg *nats.Msg) {
        // 收到消息时调用 handler
        if err := handler(context.Background(), &Message{msg: msg}); err != nil {
            c.logger.Error("handle message failed", log.String("topic", topic), log.Error(err))
            return
        }
        msg.Ack()  // 确认消息
    }, nats.DeliverNew(), nats.AckExplicit(), nats.Durable(consumerName))

    c.handlers[topic] = sub
    return nil
}
```

---

### 阶段二：业务触发 - 发布消息（Publish）

以**发布知识库**为例：

```
用户点击"发布"
         ↓
usecase/knowledge_base.go:152-166
CreateNodeReleases() + AsyncUpdateNodeReleaseVector()
         ↓
repo/mq/rag.go:44
r.producer.Produce(ctx, domain.VectorTaskTopic, "", requestBytes)
         ↓
✅ 消息发送到 NATS: "apps.panda-wiki.vector.task"
```

#### 2.1 业务层触发

**文件**: `backend/usecase/knowledge_base.go:150-169`

```go
if len(req.NodeIDs) > 0 {
    // 创建发布版本
    releaseIDs, err := u.nodeRepo.CreateNodeReleases(ctx, req.KBID, userId, req.NodeIDs)
    if err != nil {
        return "", fmt.Errorf("failed to create published nodes: %w", err)
    }
    if len(releaseIDs) > 0 {
        // 异步发送向量化任务到消息队列
        nodeContentVectorRequests := make([]*domain.NodeReleaseVectorRequest, 0)
        for _, releaseID := range releaseIDs {
            nodeContentVectorRequests = append(nodeContentVectorRequests, &domain.NodeReleaseVectorRequest{
                KBID:          req.KBID,
                NodeReleaseID: releaseID,
                Action:        "upsert",
            })
        }
        if err := u.ragRepo.AsyncUpdateNodeReleaseVector(ctx, nodeContentVectorRequests); err != nil {
            return "", err
        }
    }
}
```

#### 2.2 发送消息到 NATS

**文件**: `backend/repo/mq/rag.go:32-49`

```go
func (r *RAGRepository) AsyncUpdateNodeReleaseVector(ctx context.Context, request []*domain.NodeReleaseVectorRequest) error {
    for _, req := range request {
        contentReq := &domain.NodeContentVectorRequest{
            KBID:   req.KBID,
            ID:     req.NodeReleaseID,
            Action: req.Action,
        }
        requestBytes, err := json.Marshal(contentReq)
        if err != nil {
            return err
        }
        // 发布消息到 VectorTaskTopic
        if err := r.producer.Produce(ctx, domain.VectorTaskTopic, "", requestBytes); err != nil {
            return err
        }
    }
    return nil
}
```

---

### 阶段二补充：删除文章 - 发布删除消息（Publish）

以**删除已发布文章**为例：

```
用户删除文章
         ↓
handler/v1/node.go:170
NodeHandler.NodeAction() [action="delete"]
         ↓
usecase/node.go:139-159
NodeUsecase.NodeAction()
         ↓
repo/pg/node.go:299-336
NodeRepository.Delete() → 返回 docIDs
         ↓
repo/mq/rag.go:32-49
AsyncUpdateNodeReleaseVector() [action="delete"]
         ↓
✅ 消息发送到 NATS: "apps.panda-wiki.vector.task"
```

#### 2.3 API 入口 - 删除请求

**文件**: `backend/handler/v1/node.go:170-185`

```go
func (h *NodeHandler) NodeAction(c echo.Context) error {
    req := &domain.NodeActionReq{}
    if err := c.Bind(req); err != nil {
        return h.NewResponseWithError(c, "request body is invalid", err)
    }
    if err := c.Validate(req); err != nil {
        return h.NewResponseWithError(c, "validate request body failed", err)
    }
    ctx := c.Request().Context()
    if err := h.usecase.NodeAction(ctx, req); err != nil {
        return h.NewResponseWithError(c, "node action failed", err)
    }
    return h.NewResponseWithData(c, nil)
}
```

**请求结构** - `backend/domain/node.go`:

```go
type NodeActionReq struct {
    IDs    []string `json:"ids" validate:"required"`
    KBID   string   `json:"kb_id" validate:"required"`
    Action string   `json:"action" validate:"required,oneof=delete"`
}
```

#### 2.4 Usecase 处理删除

**文件**: `backend/usecase/node.go:139-159`

```go
func (u *NodeUsecase) NodeAction(ctx context.Context, req *domain.NodeActionReq) error {
    switch req.Action {
    case "delete":
        // 1. 从数据库删除节点，返回 docIDs
        docIDs, err := u.nodeRepo.Delete(ctx, req.KBID, req.IDs)
        if err != nil {
            return err
        }

        // 2. 构造向量化删除请求
        nodeVectorContentRequests := make([]*domain.NodeReleaseVectorRequest, 0)
        for _, docID := range docIDs {
            nodeVectorContentRequests = append(nodeVectorContentRequests, &domain.NodeReleaseVectorRequest{
                KBID:   req.KBID,
                DocID:  docID,
                Action: "delete",
            })
        }

        // 3. 异步发送到消息队列
        if err := u.ragRepo.AsyncUpdateNodeReleaseVector(ctx, nodeVectorContentRequests); err != nil {
            return err
        }
    }
    return nil
}
```

#### 2.5 数据库删除操作

**文件**: `backend/repo/pg/node.go:299-336`

```go
func (r *NodeRepository) Delete(ctx context.Context, kbID string, ids []string) ([]string, error) {
    docIDs := make([]string, 0)

    if err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
        // 1. 递归收集所有子节点ID（如果删除文件夹）
        allIDs := r.collectAllChildNodeIDs(tx, kbID, ids)

        // 2. 删除 nodes 表中的记录
        var nodes []*domain.Node
        if err := tx.Model(&domain.Node{}).
            Where("id IN ?", allIDs).
            Where("kb_id = ?", kbID).
            Clauses(clause.Returning{Columns: []clause.Column{{Name: "doc_id"}}}).
            Delete(&nodes).Error; err != nil {
            return err
        }

        // 3. 删除 node_releases 表中的记录
        var nodeReleases []*domain.NodeRelease
        if err := tx.Model(&domain.NodeRelease{}).
            Where("node_id IN ?", allIDs).
            Clauses(clause.Returning{Columns: []clause.Column{{Name: "doc_id"}}}).
            Delete(&nodeReleases).Error; err != nil {
            return err
        }

        // 4. 收集所有的 docID
        for _, node := range nodes {
            if node.DocID != "" {
                docIDs = append(docIDs, node.DocID)
            }
        }
        for _, nodeRelease := range nodeReleases {
            if nodeRelease.DocID != "" {
                docIDs = append(docIDs, nodeRelease.DocID)
            }
        }
        return nil
    }); err != nil {
        return nil, err
    }

    return lo.Uniq(docIDs), nil
}
```

**递归收集子节点** - `backend/repo/pg/node.go:339-363`:

```go
func (r *NodeRepository) collectAllChildNodeIDs(tx *gorm.DB, kbID string, parentIDs []string) []string {
    allIDs := make([]string, 0)
    allIDs = append(allIDs, parentIDs...)

    currentParentIDs := parentIDs
    for len(currentParentIDs) > 0 {
        var childIDs []string
        if err := tx.Model(&domain.Node{}).
            Where("parent_id IN ?", currentParentIDs).
            Where("kb_id = ?", kbID).
            Select("id").
            Find(&childIDs).Error; err != nil {
            break
        }

        if len(childIDs) == 0 {
            break
        }

        allIDs = append(allIDs, childIDs...)
        currentParentIDs = childIDs
    }

    return lo.Uniq(allIDs)
}
```

---

### 阶段三：消息处理 - 执行向量化

```
NATS 收到消息，推送给订阅者
         ↓
handler/mq/rag.go:38
HandleNodeContentVectorRequest(ctx, msg)
         ↓
解析 JSON: {kb_id, id, action: "upsert"}
         ↓
switch request.Action:
  case "upsert":  → h.rag.UpsertRecords()  // 向量化存储
  case "delete":  → h.rag.DeleteRecords()  // 删除向量
         ↓
✅ 向量化完成，更新数据库状态
```

#### 3.1 消息处理器

**文件**: `backend/handler/mq/rag.go:38-110`

```go
func (h *RAGMQHandler) HandleNodeContentVectorRequest(ctx context.Context, msg types.Message) error {
    var request domain.NodeContentVectorRequest
    err := json.Unmarshal(msg.GetData(), &request)
    if err != nil {
        h.logger.Error("unmarshal node content vector request failed", log.Error(err))
        return nil
    }

    switch request.Action {
    case "upsert":
        // 获取文档内容
        nodeRelease, err := h.nodeRepo.GetNodeReleaseWithDirPathByID(ctx, request.ID)
        if err != nil {
            return nil
        }
        kb, err := h.kbRepo.GetKnowledgeBaseByID(ctx, request.KBID)
        if err != nil {
            return nil
        }

        // 执行向量化
        docID, err := h.rag.UpsertRecords(ctx, kb.DatasetID, nodeRelease, groupIds)
        if err != nil {
            return nil
        }

        // 更新数据库状态
        h.nodeRepo.UpdateNodeReleaseDocID(ctx, request.ID, docID)
        h.nodeRepo.Update(ctx, nodeRelease.NodeID, map[string]interface{}{
            "rag_info": domain.RagInfo{Status: consts.NodeRagStatusBasicSucceeded},
        })

    case "delete":
        // 删除向量
        h.rag.DeleteRecords(ctx, kb.DatasetID, []string{request.ID})
    }

    return nil
}
```

#### 3.2 删除操作详细处理

**文件**: `backend/handler/mq/rag.go` (删除分支完整代码)

```go
case "delete":
    h.logger.Info("delete node content vector request", log.Any("request", request))

    // 1. 获取知识库信息，拿到 DatasetID
    kb, err := h.kbRepo.GetKnowledgeBaseByID(ctx, request.KBID)
    if err != nil {
        h.logger.Error("get kb failed", log.Error(err))
        return err  // 返回错误会触发消息重试
    }

    // 2. 调用 RAG 服务删除文档向量
    if err := h.rag.DeleteRecords(ctx, kb.DatasetID, []string{request.ID}); err != nil {
        h.logger.Error("delete node content vector failed", log.Error(err))
        return err
    }

    h.logger.Info("delete node content vector success", log.Any("deleted_id", request.ID))
```

---

#### 3.3 RAG 索引删除实现

**文件**: `backend/store/rag/ct/rag.go:155-160`

```go
func (s *CTRAG) DeleteRecords(ctx context.Context, datasetID string, docIDs []string) error {
    // 调用 CT-RAG SDK 删除文档及其向量索引
    if err := s.client.DeleteDocuments(ctx, datasetID, docIDs); err != nil {
        return err
    }
    return nil
}
```

**RAG 服务接口定义** - `backend/store/rag/rag.go`:

```go
type RAGService interface {
    CreateKnowledgeBase(ctx context.Context) (string, error)
    UpsertRecords(ctx context.Context, datasetID string, nodeRelease *domain.NodeReleaseWithDirPath, authGroupId []int) (string, error)
    QueryRecords(ctx context.Context, datasetIDs []string, query string, groupIDs []int, ...) ([]*domain.NodeContentChunk, error)
    DeleteRecords(ctx context.Context, datasetID string, docIDs []string) error  // 删除接口
    DeleteKnowledgeBase(ctx context.Context, datasetID string) error
    // ...
}
```

---

## 完整流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         服务启动阶段                                  │
├─────────────────────────────────────────────────────────────────────┤
│  wire_gen.go                                                        │
│       ↓                                                             │
│  NewRAGMQHandler()                                                  │
│       ↓                                                             │
│  RegisterHandler("apps.panda-wiki.vector.task", handler)            │
│       ↓                                                             │
│  Subscribe() ← 开始监听                                              │
└─────────────────────────────────────────────────────────────────────┘
                              ↑
                              │ 消息传递
                              │
┌─────────────────────────────────────────────────────────────────────┐
│                         业务触发阶段                                  │
├─────────────────────────────────────────────────────────────────────┤
│  用户发布文档                                                        │
│       ↓                                                             │
│  knowledge_base.go: AsyncUpdateNodeReleaseVector()                  │
│       ↓                                                             │
│  repo/mq/rag.go: Produce("apps.panda-wiki.vector.task", data)       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                         消息处理阶段                                  │
├─────────────────────────────────────────────────────────────────────┤
│  handler/mq/rag.go: HandleNodeContentVectorRequest()                │
│       ↓                                                             │
│  rag.UpsertRecords() → 向量化处理                                    │
│       ↓                                                             │
│  更新数据库状态                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 删除文章流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│                       API 请求阶段 (同步)                             │
├─────────────────────────────────────────────────────────────────────┤
│  POST /api/v1/node/action {ids, kb_id, action: "delete"}            │
│       ↓                                                             │
│  NodeHandler.NodeAction()                                           │
│       ↓                                                             │
│  NodeUsecase.NodeAction()                                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                       数据库删除阶段 (同步/事务)                       │
├─────────────────────────────────────────────────────────────────────┤
│  NodeRepository.Delete()                                            │
│       ↓                                                             │
│  collectAllChildNodeIDs() ← 递归收集子节点                            │
│       ↓                                                             │
│  DELETE FROM nodes WHERE id IN (...)  → 返回 docIDs                 │
│       ↓                                                             │
│  DELETE FROM node_releases WHERE node_id IN (...) → 返回 docIDs     │
│       ↓                                                             │
│  返回去重后的 docIDs                                                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                       消息发送阶段 (同步)                             │
├─────────────────────────────────────────────────────────────────────┤
│  为每个 docID 构造 NodeReleaseVectorRequest                          │
│       ↓                                                             │
│  AsyncUpdateNodeReleaseVector()                                     │
│       ↓                                                             │
│  Produce("apps.panda-wiki.vector.task", {kb_id, id, action:"delete"})│
│       ↓                                                             │
│  ✅ API 返回成功                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ↓ (异步)
┌─────────────────────────────────────────────────────────────────────┐
│                       索引删除阶段 (异步)                             │
├─────────────────────────────────────────────────────────────────────┤
│  NATS 消费者接收消息                                                  │
│       ↓                                                             │
│  HandleNodeContentVectorRequest()                                   │
│       ↓                                                             │
│  GetKnowledgeBaseByID() → 获取 DatasetID                            │
│       ↓                                                             │
│  RAGService.DeleteRecords(datasetID, docIDs)                        │
│       ↓                                                             │
│  CT-RAG SDK: DeleteDocuments()                                      │
│       ↓                                                             │
│  ✅ 向量索引删除完成                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 删除机制设计要点

| 特性 | 说明 |
|------|------|
| **两阶段删除** | 数据库删除(同步) + 索引删除(异步) |
| **递归删除** | 删除文件夹时自动递归删除所有子节点 |
| **事务保证** | 数据库操作使用 GORM 事务确保一致性 |
| **docID 追踪** | 从 `nodes` 和 `node_releases` 两张表收集 docID |
| **异步解耦** | 通过消息队列解耦，API 快速响应 |
| **重试机制** | 消息队列支持失败重试，最多 5 次 |
| **幽灵记录防护** | 确保删除的文章不会在搜索中出现 |

---

## 消息数据结构

### 请求结构

**文件**: `backend/domain/mq.go`

```go
type NodeContentVectorRequest struct {
    KBID   string `json:"kb_id"`
    ID     string `json:"id"`
    Action string `json:"action"` // upsert, delete
}

type NodeReleaseVectorRequest struct {
    KBID          string `json:"kb_id"`
    NodeReleaseID string `json:"node_release_id"`
    NodeID        string `json:"node_id"`
    DocID         string `json:"doc_id"`
    Action        string `json:"action"` // upsert, delete, summary
    GroupIds      []int  `json:"group_ids"`
}
```

### Action 类型

| Action | 说明 |
|--------|------|
| `upsert` | 创建或更新向量 |
| `delete` | 删除向量 |
| `summary` | 生成摘要 |
| `update_group_ids` | 更新权限组 |

---

## 关键文件索引

| 文件 | 作用 |
|------|------|
| `backend/domain/mq.go` | Topic 常量和消息结构定义 |
| `backend/domain/node.go` | 节点数据模型和请求结构 |
| `backend/mq/nats/consumer.go` | NATS 消费者，处理订阅逻辑 |
| `backend/handler/v1/node.go` | 节点 API 入口（包括删除） |
| `backend/handler/mq/rag.go` | 向量化任务处理器（upsert/delete） |
| `backend/repo/mq/rag.go` | 发布消息到 MQ |
| `backend/repo/pg/node.go` | 节点数据库操作（含递归删除） |
| `backend/usecase/knowledge_base.go` | 业务层触发向量化（发布） |
| `backend/usecase/node.go` | 节点业务逻辑（含删除处理） |
| `backend/store/rag/ct/rag.go` | CT-RAG 索引操作实现 |
| `backend/store/rag/rag.go` | RAG 服务接口定义 |
| `backend/cmd/consumer/wire_gen.go` | Wire 依赖注入，服务启动 |
