---
tags:
  - RAG
  - RAGLite
  - PandaWiki
  - 知识库
created: '2026-04-04'
project: PandaWiki
---
# RAGLite 文档入库流水线

## 整体流程

当 PandaWiki 发布一篇文章时，文档会经过以下 6 个阶段被处理成可检索的知识：

```
用户发布文章
     │
     ▼
PandaWiki 预处理（HTML/Excel → Markdown）
     │
     ▼  通过 raglite-go-sdk 上传
     │
╔════════════════════════════════════════════╗
║           RAGLite 服务端内部处理              ║
║                                            ║
║  1. Loading ──→ 解析文档，提取纯文本          ║
║       │                                    ║
║       ▼                                    ║
║  2. Splitting ──→ 按语义/长度切成多个 chunk   ║
║       │                                    ║
║       ▼                                    ║
║  3. Enhancing ──→ LLM 补充上下文、生成问题     ║
║       │            （chat 模型）              ║
║       ▼                                    ║
║  4. Summarizing ──→ LLM 生成摘要             ║
║       │              （chat 模型）            ║
║       ▼                                    ║
║  5. Embedding ──→ 文本转向量                  ║
║       │            （embedding 模型）         ║
║       ▼                                    ║
║  6. Storing ──→ 向量+元数据写入 Qdrant        ║
║                                            ║
╚════════════════════════════════════════════╝
```

## 各阶段详解

| 阶段 | 做什么 | 调用模型 | 核心作用 |
|------|--------|---------|---------|
| **Loading** | 解析原始文档为纯文本 | 无 | 格式归一化 |
| **Splitting** | 长文本切成多个 chunk | 无 | 创建检索基本单位 |
| **Enhancing** | 补充上下文、生成预测问题、添加关键词 | chat（MiniMax） | 让 chunk 更容易被检索命中 |
| **Summarizing** | 生成 chunk/文档摘要 | chat（MiniMax） | 支持多级检索，先粗筛再精匹配 |
| **Embedding** | 文本转为高维向量 | embedding（bge-m3） | 语义检索的核心 |
| **Storing** | 写入向量数据库 | 无 | 持久化，供后续查询 |

## Enhancing 举例

假设原文是《2025年公司薪酬管理制度》，被切成了这个 chunk：

> **裸 chunk**: "该方案适用于试用期满的正式员工。绩效系数按季度考核结果确定，A级为1.5，B级为1.2，C级为1.0，D级为0.8。"

这段话脱离原文后的问题：
- "该方案"是什么方案？
- 这是哪个公司的制度？

**LLM 增强后**大致会生成：

```
【上下文补充】
本段来自《2025年公司薪酬管理制度》中的"绩效奖金方案"章节。
"该方案"指绩效奖金分配方案。

【该 chunk 可能回答的问题】
- 绩效系数是怎么确定的？
- A级绩效对应的系数是多少？
- 试用期员工能拿绩效奖金吗？

【关键词】
薪酬管理、绩效系数、季度考核、绩效奖金、正式员工
```

### 有增强 vs 无增强对比

| 场景 | 无增强（裸 chunk） | 有增强 |
|------|-------------------|--------|
| 用户问"绩效A级系数多少" | chunk 里有"A级为1.5"，可能命中 | 增强后有预生成问题，**更容易命中** |
| 用户问"试用期能拿奖金吗" | chunk 里只有"试用期满的正式员工"，可能**不命中** | 增强后有对应问题，**能命中** |
| 用户问"该方案是什么" | "该方案"指代不明，**匹配混乱** | 明确了指代关系，**精确匹配** |

## Summarizing 举例

同一个 chunk，LLM 生成摘要：

> 绩效奖金方案适用于正式员工，绩效系数按季度考核分为A(1.5)、B(1.2)、C(1.0)、D(0.8)四档。

**作用**: 检索时先用摘要粗筛，再精匹配 chunk，提高效率。

## 职责划分

| 职责 | 谁负责 |
|------|--------|
| 文档格式转换（HTML/Excel → Markdown） | **PandaWiki** 后端 |
| 模型配置同步（API地址、密钥、参数） | **PandaWiki** → 通过 SDK 推送给 RAGLite |
| 6 阶段处理流水线 | **RAGLite** 服务端独立完成 |
| 分块策略（ChunkSize / ChunkOverlap） | **RAGLite** 服务端默认值（PandaWiki 未自定义） |
| LLM 实际调用 | **RAGLite** 用 PandaWiki 同步过来的模型配置自行调用 |

## 分块配置现状

| 参数 | SDK 示例推荐值 | PandaWiki 实际 | 说明 |
|------|---------------|---------------|------|
| ChunkSize | 512 tokens | 未传，用服务端默认 | 每个 chunk 最大 token 数 |
| ChunkOverlap | 50~100 tokens | 未传，用服务端默认 | 相邻 chunk 重叠部分，保证上下文连贯 |

## 性能瓶颈

**Enhancing 和 Summarizing** 是最耗时的两个阶段，因为每个 chunk 都要调用一次 LLM API。

- 文档越大 → chunk 越多 → 等待时间越长
- 卡在这两步通常是 LLM API 响应慢、限流或超时导致

## 关键代码位置

- `backend/store/rag/ct.go:100-161` — UpsertRecords，PandaWiki 上传文档到 RAGLite
- `backend/store/rag/ct.go:205-231` — AddModel，同步模型配置到 RAGLite
- `backend/store/rag/ct.go:233-261` — UpsertModel，更新模型配置
- `backend/store/rag/ct.go:42-48` — CreateKnowledgeBase，创建 Dataset（未传分块参数）
