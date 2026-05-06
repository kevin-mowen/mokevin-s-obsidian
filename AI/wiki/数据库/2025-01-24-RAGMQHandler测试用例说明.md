# RAGMQHandler 测试用例说明

**日期**: 2025-01-24
**测试文件**: `backend/handler/mq/rag_test.go`
**关联修复**: 修复重新学习旧文档残留问题

## 测试背景

为 `RAGMQHandler.HandleNodeContentVectorRequest` 方法编写单元测试，验证：
1. 重新学习时正确删除旧文档
2. 首次学习时不执行多余删除操作
3. 各种边界情况的正确处理

## 测试用例列表

### 1. TestUpsert_WithExistingDocID

**场景**: 重新学习已存在的文档

**验证点**:
- 当 `nodeRelease.DocID` 不为空时，应先调用 `DeleteRecords` 删除旧文档
- 然后调用 `UpsertRecords` 创建新文档
- 最后更新 `doc_id` 和 `rag_info` 状态

**预期结果**:
- `DeleteRecords` 被调用，参数为旧的 `doc_id`
- `UpsertRecords` 被调用，返回新的 `doc_id`
- 处理成功，无错误返回

```go
// 关键断言
ts.rag.AssertCalled(t, "DeleteRecords", ctx, datasetID, []string{oldDocID})
ts.rag.AssertCalled(t, "UpsertRecords", ctx, datasetID, nodeRelease, []int{1, 2})
```

---

### 2. TestUpsert_WithoutExistingDocID

**场景**: 首次学习新文档

**验证点**:
- 当 `nodeRelease.DocID` 为空时，不应调用 `DeleteRecords`
- 直接调用 `UpsertRecords` 创建文档

**预期结果**:
- `DeleteRecords` 不被调用
- `UpsertRecords` 被调用
- 处理成功

```go
// 关键断言
ts.rag.AssertNotCalled(t, "DeleteRecords", mock.Anything, mock.Anything, mock.Anything)
ts.rag.AssertCalled(t, "UpsertRecords", ctx, datasetID, nodeRelease, []int{1, 2})
```

---

### 3. TestUpsert_OldDocDeletionFails_ContinuesWithUpsert

**场景**: 旧文档删除失败（如文档已不存在）

**验证点**:
- 即使 `DeleteRecords` 返回错误，也应继续执行 `UpsertRecords`
- 删除失败不应阻断主流程

**预期结果**:
- `DeleteRecords` 被调用并返回错误
- `UpsertRecords` 仍然被调用
- 整体处理成功

```go
// Mock 设置
ts.rag.On("DeleteRecords", ctx, datasetID, []string{oldDocID}).Return(errors.New("document not found"))
ts.rag.On("UpsertRecords", ctx, datasetID, nodeRelease, []int{1, 2}).Return(newDocID, nil)

// 关键断言
assert.NoError(t, err) // 整体无错误
ts.rag.AssertCalled(t, "DeleteRecords", ...)
ts.rag.AssertCalled(t, "UpsertRecords", ...)
```

---

### 4. TestUpsert_FolderNode_Skipped

**场景**: 处理文件夹类型节点

**验证点**:
- 文件夹节点（`NodeTypeFolder`）应被跳过，不执行向量化

**预期结果**:
- `DeleteRecords` 不被调用
- `UpsertRecords` 不被调用
- 处理成功返回

```go
// 关键断言
ts.rag.AssertNotCalled(t, "DeleteRecords", ...)
ts.rag.AssertNotCalled(t, "UpsertRecords", ...)
```

---

### 5. TestDelete_Success

**场景**: 删除文档操作成功

**验证点**:
- `action` 为 `delete` 时，正确调用 `DeleteRecords`
- 使用请求中的 `DocID` 进行删除

**预期结果**:
- `DeleteRecords` 被调用，参数正确
- 处理成功

```go
// 关键断言
ts.rag.AssertCalled(t, "DeleteRecords", ctx, datasetID, []string{docID})
```

---

### 6. TestDelete_EmptyDocID_Skipped

**场景**: 删除操作但 DocID 为空

**验证点**:
- 当删除请求的 `DocID` 为空时，应跳过操作

**预期结果**:
- `DeleteRecords` 不被调用
- 处理成功返回

```go
// 关键断言
ts.rag.AssertNotCalled(t, "DeleteRecords", ...)
```

---

### 7. TestInvalidJSON_NoRetry

**场景**: 消息体为无效 JSON

**验证点**:
- JSON 解析失败时，应返回 `nil`（不触发重试）
- 不应执行任何 RAG 操作

**预期结果**:
- 返回 `nil`，不触发 MQ 重试机制
- 不调用任何 RAG 方法

```go
// 关键断言
assert.NoError(t, err)
ts.rag.AssertNotCalled(t, "DeleteRecords", ...)
ts.rag.AssertNotCalled(t, "UpsertRecords", ...)
```

---

## Mock 对象说明

### MockMessage

实现 `types.Message` 接口：

```go
type MockMessage struct {
    data         []byte   // 消息数据
    numDelivered uint64   // 投递次数
}

func (m *MockMessage) GetData() []byte
func (m *MockMessage) GetNumDelivered() uint64
func (m *MockMessage) GetTopic() string
```

### MockRAGService

模拟 RAG 服务：

```go
func UpsertRecords(ctx, datasetID, nodeRelease, groupIds) (string, error)
func DeleteRecords(ctx, datasetID, docIDs) error
```

### MockNodeRepository

模拟节点仓库：

```go
func GetNodeReleaseWithDirPathByID(ctx, nodeReleaseID) (*NodeReleaseWithDirPath, error)
func GetNodeAuthGroupIdsByNodeId(ctx, nodeID, permType) ([]int, error)
func UpdateNodeReleaseDocID(ctx, nodeReleaseID, docID) error
func Update(ctx, nodeID, updates) error
```

### MockKBRepository

模拟知识库仓库：

```go
func GetKnowledgeBaseByID(ctx, kbID) (*KnowledgeBase, error)
```

## 运行测试

```bash
# 运行所有 MQ Handler 测试
cd backend
go test -v ./handler/mq/...

# 运行特定测试
go test -v ./handler/mq/... -run TestUpsert_WithExistingDocID

# 查看测试覆盖率
go test -cover ./handler/mq/...
```

## 测试结果

```
=== RUN   TestUpsert_WithExistingDocID
--- PASS: TestUpsert_WithExistingDocID (0.00s)
=== RUN   TestUpsert_WithoutExistingDocID
--- PASS: TestUpsert_WithoutExistingDocID (0.00s)
=== RUN   TestUpsert_OldDocDeletionFails_ContinuesWithUpsert
--- PASS: TestUpsert_OldDocDeletionFails_ContinuesWithUpsert (0.00s)
=== RUN   TestUpsert_FolderNode_Skipped
--- PASS: TestUpsert_FolderNode_Skipped (0.00s)
=== RUN   TestDelete_Success
--- PASS: TestDelete_Success (0.00s)
=== RUN   TestDelete_EmptyDocID_Skipped
--- PASS: TestDelete_EmptyDocID_Skipped (0.00s)
=== RUN   TestInvalidJSON_NoRetry
--- PASS: TestInvalidJSON_NoRetry (0.00s)
PASS
ok      github.com/chaitin/panda-wiki/handler/mq    1.004s
```

**结果**: 7/7 测试通过
