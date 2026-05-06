# 对外接口速查（12 个）

所有接口：
- 路径前缀：`/api/v1/kb`
- 方法：**POST**（`/ping` 是 GET 且免鉴权）
- 鉴权：`Authorization: Bearer <system_api_token>`（仅系统级 Token）
- Content-Type：`application/json`
- 公共必填 body 字段：`system_id`、`access_credential`（`/ping` 除外）

## 查询类（只读）

| # | 路径 | 一句话用途 | 关键入参 | 关键返回 |
|---|------|------------|---------|---------|
| 1 | `/list` | 列出当前用户有权限的知识库 | — | `items[].kb_id`、`kb_name`、`node_count` |
| 2 | `/folders` | 某个 KB 的文件夹目录树 | `kb_id` | 嵌套的 `folder_id` + `children` |
| 3 | `/folder/docs` | 某文件夹下的文档列表（分页）| `folder_id` | `items[].doc_id`、`has_more` |
| 4 | `/search/documents` | 语义检索**文档**（每篇一条）| `query` | `items[].doc_id`、`summary`、`doc_url` |
| 5 | `/search/chunks` | 语义检索**切块**（RAG）| `query` | `items[].content`、`doc_id`、`kb_id` |
| 6 | `/doc/detail` | 读文档原文（支持分片续读、摘要模式）| `doc_id` | `content`、`content_length`、`next_offset` |
| 7 | `/chat` | AI 问答（流式 / 非流式，多轮）| `query`、`stream` | `answer` / SSE 事件流 |

## 写入类

| # | 路径 | 一句话用途 | 关键入参 | 关键返回 |
|---|------|------------|---------|---------|
| 8 | `/folder/create` | 创建文件夹 | `kb_id`、`name`、`parent_id` | `folder_id` |
| 9 | `/doc/create` | 创建空文档 | `kb_id`、`name`、`parent_id` | `doc_id` |
| 10 | `/upload` | 上传文件并解析为文档（multipart）| `file`、`kb_id`、`parent_id`、`auto_publish` | `doc_id` |
| 11 | `/doc/edit` | 编辑文档内容 / 标题 / 摘要 | `doc_id`、`content`/`name`/`summary` | 成功标识 |
| 12 | `/doc/publish` | 批量发布文档（触发 RAG 学习）| `doc_ids` | 成功标识 |

## 辅助接口

| 路径 | 方法 | 鉴权 | 用途 |
|------|------|------|------|
| `/ping` | GET | ❌ | 健康检查、测 `base_url` 是否正确、时钟漂移对照 |

## 常见调用链

### 链路 A：问答型 Skill（最常见）

```
/list       → 确认用户能访问的 KB
/chat       → 直接问（stream=true）
```

### 链路 B：搜索 + 回填原文

```
/search/documents  → 拿到候选 doc_id 列表
/doc/detail        → 取原文（可分片续读）
```

### 链路 C：上传并发布

```
/folders           → 让用户选择目标文件夹
/upload            → multipart 上传（建议 auto_publish=false）
/doc/edit          → 可选：微调标题 / 摘要
/doc/publish       → 统一发布触发 RAG 学习
```

### 链路 D：新建空文档后再编辑

```
/doc/create        → 创建空文档，拿 doc_id
/doc/edit          → 填充 content（可多次增量编辑）
/doc/publish       → 发布
```

## 公共查询过滤参数

这组参数出现在 `/search/*`、`/chat`、`/doc/detail` 等接口上，行为统一：

| 参数 | 类型 | 语义 |
|------|------|------|
| `kb_ids` | string[] | 限定知识库；不传则走 token 授权范围 |
| `folder_ids` | string[] | 限定文件夹（多个）|
| `doc_ids` | string[] | 限定具体文档 |
| `top_k` | int | 返回数量上限，默认 10，硬上限 20（搜索类接口）|

三者都不传 → 在 token 授权范围内全局搜；同时传 → 取交集。

## 内容截断统一规则

这三个接口都会对输出做截断，调用方要读对应的字段判断是否截断：

| 接口 | 截断字段 | 说明 |
|------|---------|------|
| `/search/chunks` | `items[].content`（800 rune）、`items[].content_truncated`、顶层 `truncated` | 切块内容超 800 rune 截断；完整内容用 `/doc/detail` |
| `/search/documents` | `items[].summary`（200 rune）、`items[].summary_truncated`、顶层 `truncated` | 摘要超 200 rune 截断 |
| `/chat` | `references[].summary`（200 rune）、`references_total`、`references_truncated` | 最多 10 条引用，超出在 `references_total` 里体现 |
| `/doc/detail` | `content`（默认 30000 rune，上限 50000）、`content_length`、`returned_length`、`truncated`、`next_offset` | 大文档需通过 `offset` 续读 |

## 更多细节

- 单接口字段说明见 Obsidian `AI/wiki/接口文档/`
- 机器可读 schema：`openapi.json`（由 `make generate` 产出）
- 错误码与重试策略：[error-codes.md](./error-codes.md)

## 变更历史

- 2026-04-22: 初始化接口速查表（12 个对外接口 + `/ping`）
