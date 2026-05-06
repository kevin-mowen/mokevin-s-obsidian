# PandaWiki 与 RAG 数据表关联关系

## 概述

PandaWiki 使用 raglite 作为 RAG（检索增强生成）服务，两个系统通过特定字段进行数据关联。

## 数据表关系图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              PandaWiki 数据库                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────┐         ┌─────────────────────┐                       │
│  │   knowledge_bases   │         │       nodes         │                       │
│  ├─────────────────────┤         ├─────────────────────┤                       │
│  │ id (PK)             │         │ id (PK)             │                       │
│  │ name                │         │ kb_id (FK)          │←──┐                   │
│  │ dataset_id ─────────┼────┐    │ type                │   │                   │
│  │ access_settings     │    │    │ status              │   │                   │
│  │ created_at          │    │    │ name                │   │                   │
│  │ updated_at          │    │    │ content             │   │                   │
│  └─────────────────────┘    │    │ parent_id           │   │                   │
│           │                 │    │ ...                 │   │                   │
│           │                 │    └─────────────────────┘   │                   │
│           │                 │              │               │                   │
│           │                 │              │ 发布          │                   │
│           │                 │              ▼               │                   │
│           │                 │    ┌─────────────────────┐   │                   │
│           │                 │    │   node_releases     │   │                   │
│           │                 │    ├─────────────────────┤   │                   │
│           │                 │    │ id (PK)             │   │                   │
│           │                 │    │ kb_id (FK) ─────────┼───┘                   │
│           │                 │    │ node_id (FK)        │←── 关联 nodes.id      │
│           │                 │    │ doc_id ─────────────┼────────┐              │
│           │                 │    │ name                │        │              │
│           │                 │    │ content             │        │              │
│           │                 │    │ publisher_id        │        │              │
│           │                 │    │ created_at          │        │              │
│           │                 │    │ updated_at          │        │              │
│           │                 │    └─────────────────────┘        │              │
│           │                 │                                   │              │
└───────────┼─────────────────┼───────────────────────────────────┼──────────────┘
            │                 │                                   │
            │                 │                                   │
            ▼                 ▼                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              raglite 数据库                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐ │
│  │      datasets       │    │     documents       │    │       chunks        │ │
│  ├─────────────────────┤    ├─────────────────────┤    ├─────────────────────┤ │
│  │ id (PK) ←───────────┼────│ dataset_id (FK)     │    │ id (PK)             │ │
│  │ name                │    │ id (PK) ←───────────┼────│ document_id (FK)    │ │
│  │ embedding_model     │    │ name                │    │ content             │ │
│  │ chunk_method        │    │ location            │    │ dataset_id          │ │
│  │ chunk_count         │    │ chunk_method        │    │ group_ids           │ │
│  │ document_count      │    │ chunk_count         │    │ similarity          │ │
│  │ parser_config       │    │ status              │    │ ...                 │ │
│  │ ...                 │    │ ...                 │    │                     │ │
│  └─────────────────────┘    └─────────────────────┘    └─────────────────────┘ │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 表关联关系详解

### 1. knowledge_bases ↔ datasets（一对一）

| PandaWiki | raglite | 说明 |
|-----------|---------|------|
| `knowledge_bases.dataset_id` | `datasets.id` | 每个知识库对应一个 RAG 数据集 |

**创建流程**：
1. 创建知识库时，先在 raglite 创建 dataset
2. raglite 返回 `dataset.id`
3. 存入 `knowledge_bases.dataset_id`

### 2. node_releases ↔ documents（一对一）

| PandaWiki | raglite | 说明 |
|-----------|---------|------|
| `node_releases.doc_id` | `documents.id` | 每个发布版本对应一个 RAG 文档 |

**发布流程**：
1. 用户发布文档，创建 `node_release` 记录
2. 将内容上传到 raglite，创建 `document`
3. raglite 返回 `document.id`
4. 存入 `node_releases.doc_id`

### 3. documents ↔ chunks（一对多）

| raglite | 说明 |
|---------|------|
| `chunks.document_id` → `documents.id` | 一个文档被分割成多个向量分块 |

**分块流程**：
1. raglite 接收文档内容
2. 根据 `chunk_method` 进行分块
3. 每个分块生成向量嵌入
4. 存储到 `chunks` 表

## PandaWiki 核心表结构

### knowledge_bases（知识库）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 主键，知识库 ID |
| `name` | string | 知识库名称 |
| `dataset_id` | string | **关联 raglite datasets.id** |
| `access_settings` | jsonb | 访问设置（端口、域名、认证等） |
| `created_at` | timestamp | 创建时间 |
| `updated_at` | timestamp | 更新时间 |

### nodes（文档/文件夹）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 主键，节点 ID |
| `kb_id` | string | 所属知识库 ID |
| `type` | uint16 | 类型：1=文件夹，2=文档 |
| `status` | uint16 | 状态：1=草稿，2=已发布 |
| `name` | string | 名称 |
| `content` | string | 内容（当前编辑版本） |
| `meta` | jsonb | 元信息 |
| `parent_id` | string | 父节点 ID |
| `position` | float64 | 排序位置 |
| `creator_id` | string | 创建者 |
| `editor_id` | string | 最后编辑者 |
| `rag_info` | jsonb | RAG 信息 |
| `permissions` | jsonb | 权限设置 |

### node_releases（发布版本）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 主键，发布版本 ID |
| `kb_id` | string | 所属知识库 ID |
| `node_id` | string | 关联的节点 ID |
| `doc_id` | string | **关联 raglite documents.id** |
| `name` | string | 发布时的名称 |
| `content` | string | 发布时的内容快照 |
| `publisher_id` | string | 发布者 ID |
| `editor_id` | string | 编辑者 ID |
| `type` | uint16 | 节点类型 |
| `meta` | jsonb | 元信息 |
| `parent_id` | string | 父节点 ID |
| `position` | float64 | 排序位置 |
| `created_at` | timestamp | 创建时间 |
| `updated_at` | timestamp | 更新时间 |

## raglite 核心表结构

### datasets（数据集）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 主键，数据集 ID |
| `name` | string | 名称 |
| `embedding_model` | string | 嵌入模型 |
| `chunk_method` | string | 分块方式 |
| `chunk_count` | int | 分块总数 |
| `document_count` | int | 文档数量 |
| `parser_config` | json | 解析配置 |
| `similarity_threshold` | float64 | 相似度阈值 |

### documents（文档）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 主键，文档 ID |
| `dataset_id` | string | 所属数据集 ID |
| `name` | string | 文档名称 |
| `location` | string | 存储位置 |
| `chunk_method` | string | 分块方式 |
| `chunk_count` | int | 分块数量 |
| `token_count` | int | Token 数量 |
| `status` | string | 状态 |
| `group_ids` | []int | 权限组 |

### chunks（向量分块）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 主键，分块 ID |
| `document_id` | string | 所属文档 ID |
| `dataset_id` | string | 所属数据集 ID |
| `content` | string | 分块内容（向量化的文本片段） |
| `group_ids` | []int | 权限组（用于访问控制） |
| `important_keywords` | []string | 重要关键词（需配置 `AutoKeywords` 才会生成） |
| `questions` | []string | 相关问题（需配置 `AutoQuestions` 才会生成） |
| `available` | bool | 是否可用 |
| `create_time` | string | 创建时间 |
| `create_timestamp` | float64 | 创建时间戳 |

**注意**：chunks 与 PandaWiki 没有直接的字段关联，通过 `document_id` → `documents` → `node_releases.doc_id` 间接关联。

## 数据关联链路总结

| raglite 表 | 关联 PandaWiki 表 | 关联字段 | 关系 |
|------------|-------------------|---------|------|
| `datasets` | `knowledge_bases` | `datasets.id` = `knowledge_bases.dataset_id` | 1:1 |
| `documents` | `node_releases` | `documents.id` = `node_releases.doc_id` | 1:1 |
| `chunks` | **无直接关联** | 通过 `chunks.document_id` → `documents` → `node_releases` | 间接 |

### 检索结果关联回 PandaWiki

```go
// usecase/llm.go - 检索流程
// 1. 从 raglite 获取匹配的 chunks
records, err := u.rag.QueryRecords(ctx, datasetIDs, question, ...)

// 2. 从 chunks 中提取 doc_ids
docIDs := lo.Map(records, func(item *domain.NodeContentChunk, _ int) string {
    return item.DocID  // 这是 raglite documents.id
})

// 3. 通过 doc_id 查询对应的 node_release，获取文档名称、路径等信息
docIDNode, err := u.nodeRepo.GetNodeReleasesWithPathsByDocIDs(ctx, docIDs)
```

## 数据流转示意

```
用户操作                    PandaWiki                         raglite
────────────────────────────────────────────────────────────────────────────

1. 创建知识库
   ──────────────────→  knowledge_bases.insert()
                              │
                              ├──→ CreateDataset() ──────→ datasets.insert()
                              │         │
                              │         └── 返回 dataset.id
                              │
                        保存 dataset_id

2. 创建文档
   ──────────────────→  nodes.insert(status=草稿)
                        (仅本地保存，不涉及 raglite)

3. 发布文档
   ──────────────────→  node_releases.insert()
                              │
                              ├──→ UploadDocument() ─────→ documents.insert()
                              │         │                        │
                              │         └── 返回 doc.id          ├──→ 自动解析
                              │                                  │
                        保存 doc_id                        chunks.insert(多条)

4. 向量检索
   ──────────────────→  QueryRecords(dataset_ids)
                              │
                              └──→ RetrieveChunks() ─────→ 向量相似度检索
                                        │
                                        └── 返回匹配的 chunks
```

## 检索机制

### 向量检索（当前使用）

```
用户查询 → embedding 模型 → 查询向量 → 余弦相似度计算 → 返回匹配 chunks
```

**特点**：
- 基于文本内容的**语义**进行匹配
- 不依赖 `important_keywords` 字段
- 能理解同义词、相似表达

### 关键词检索（未启用）

需要在检索请求中设置 `Keyword: true` 才会启用。

**当前代码**（`store/rag/ct/rag.go`）：
```go
retrieveReq := rag.RetrievalRequest{
    DatasetIDs: datasetIDs,
    Question:   query,
    TopK:       10,
    // Keyword: false (默认值，未启用关键词检索)
}
```

### 关键词配置

`important_keywords` 字段需要在创建数据集时配置 `ParserConfig.AutoKeywords` 才会自动生成：

```go
// 当前代码（store/rag/ct/rag.go）- 未配置
dataset, err := s.client.CreateDataset(ctx, rag.CreateDatasetRequest{
    Name: uuid.New().String(),
    // ParserConfig 未设置，AutoKeywords 默认为 0
})

// 如需启用关键词，应改为：
dataset, err := s.client.CreateDataset(ctx, rag.CreateDatasetRequest{
    Name: uuid.New().String(),
    ParserConfig: rag.ParserConfig{
        AutoKeywords:  5,    // 自动提取 5 个关键词
        AutoQuestions: 0,    // 自动生成问题数
    },
})
```

| 配置项 | 说明 | 当前状态 |
|--------|------|---------|
| `AutoKeywords` | 自动提取关键词数量 | ❌ 未配置（默认 0） |
| `AutoQuestions` | 自动生成问题数量 | ❌ 未配置（默认 0） |
| 关键词检索 | 检索时启用关键词匹配 | ❌ 未启用 |

**结论**：当前 `important_keywords` 为空不影响检索，因为使用的是向量检索。

## 已知问题

### 1. 删除知识库时 RAG 数据残留（已修复）

**问题**：删除知识库时传错参数，导致 raglite dataset 未删除

**状态**：✅ 已修复（2026-01-24）

### 2. 删除节点时 RAG 文档未删除（已修复）

**问题**：删除已发布的文档节点时，消息转换丢失 `DocID`，导致 raglite document 未被删除

**状态**：✅ 已修复（2026-01-24）

### 3. 旧版本文档未清理（待修复）

**问题**：
- 每次发布文档都会在 raglite 创建新的 document
- 旧版本的 document 和 chunks 没有被清理
- 导致向量检索可能返回旧版本内容

**影响**：
- RAG 存储空间浪费
- 检索结果可能包含过时内容

### 4. 无明确的"最新版本"标识（待优化）

**问题**：
- `node_releases` 表没有 `is_latest` 或 `is_current` 字段
- 查询最新版本需要通过 `ORDER BY updated_at DESC LIMIT 1`

**影响**：
- 查询效率不高
- 无法快速判断哪个是当前生效版本

## 相关文档

- [删除知识库 RAG 数据残留修复](./2026-01-24-删除知识库RAG数据残留修复.md)
- [删除知识库 RAG 数据残留修复 - 测试用例](./2026-01-24-删除知识库RAG数据残留修复-测试用例.md)
- [删除节点 RAG 文档残留修复](./2026-01-24-删除节点RAG文档残留修复.md)
- [删除节点 RAG 文档残留修复 - 测试用例](./2026-01-24-删除节点RAG文档残留修复-测试用例.md)
