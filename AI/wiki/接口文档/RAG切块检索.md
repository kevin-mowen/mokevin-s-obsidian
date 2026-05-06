# RAG 切块检索

## 功能描述

在用户有权限的知识库中，搜索最相关的 RAG 文本切块（chunks），返回切块文本内容。可作为 FastGPT 等智能体的知识库搜索节点。

## API 接口

| 方法 | 路径 |
|------|------|
| POST | `/api/v1/kb/search/chunks` |

## 请求头

| Header | 必填 | 说明 |
|--------|------|------|
| Authorization | 是 | `Bearer <system_api_token>`，仅支持系统级 API Token（在系统配置 → 系统 API Token 中创建），KB 级别 Token 不可用。Token 需找管理员获取 |
| Content-Type | 是 | `application/json` |

## 请求参数

| 参数         | 类型       | 必填  | 说明                                                | 示例                 |
| ---------- | -------- | --- | ------------------------------------------------- | ------------------ |
| system_id  | string   | 是   | 调用方系统编号                                           | `"fastgpt"`        |
| agent_id   | string   | 否   | 智能体 ID                                            | `"bot_12345"`      |
| access_credential | string | 是 | 使用 notes_id + Secret 经 AES-256-GCM 加密后的 Base64 密文，Secret 需找管理员获取 | `"nGhJ8kL2mN..."` |
| query      | string   | 是   | 搜索的问题或关键词                                         | `"如何配置数据库连接？"`     |
| kb_ids     | string[] | 否   | 限定知识库范围，不传则搜全部知识库                                 | `["3adce2bd-..."]` |
| folder_ids | string[] | 否   | 只搜指定文件夹下的文档，支持多个                                  | `["aaa-bbb-ccc"]`  |
| doc_ids    | string[] | 否   | 只搜指定的文档                                           | `["019b6e86-..."]` |
| top_k      | number   | 否   | 返回数量上限，默认 10，硬上限 20                                | `10`               |

## 调用示例

```bash
curl -s -X POST http://localhost:18000/api/v1/kb/search/chunks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <system_api_token>" \
  -d '{
    "system_id": "fastgpt",
    "access_credential": "<AES-256-GCM加密后的Base64密文>",
    "query": "如何配置数据库连接？",
    "top_k": 5
  }' | jq
```

## 成功响应

```json
{
  "success": true,
  "code": 0,
  "message": "success",
  "data": {
    "total": 42,
    "truncated": true,
    "items": [
      {
        "content": "数据库连接配置方法：首先打开 config.yaml 文件...",
        "doc_id": "019b6e86-...",
        "doc_name": "数据库配置指南",
        "doc_url": "http://wiki.example.com/node/019b6e86-...?kb=3adce2bd-...",
        "kb_id": "3adce2bd-...",
        "kb_name": "技术文档库",
        "content_length": 1240,
        "content_truncated": true
      }
    ]
  }
}
```

## 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| data.total | number | 权限过滤后的 chunk 总数（截断前） |
| data.truncated | bool | 是否因 top_k 或 chunk content 截断导致内容不完整 |
| data.items[].content | string | 切块文本内容（单个 chunk 超 800 rune 会被截断） |
| data.items[].doc_id | string | 所属文档 ID |
| data.items[].doc_name | string | 所属文档名称 |
| data.items[].doc_url | string | 文档访问链接 |
| data.items[].kb_id | string | 所属知识库 ID |
| data.items[].kb_name | string | 所属知识库名称 |
| data.items[].content_length | int | content 字段原始 rune 长度 |
| data.items[].content_truncated | bool | content 是否被截断 |

## 限制规则

- `top_k` 默认 10，硬上限 20（超出静默钳制）
- 单个 chunk `content` 超 800 rune 截断
- 获取完整内容：通过 `doc_id` 调 `/api/v1/kb/doc/detail` 接口

## 权限过滤

搜索结果会经过双层权限过滤：
1. **文档自身** visitable 权限：closed 的文档不返回，partial 的文档只有授权用户可见
2. **父文件夹** visitable 权限：父文件夹为 closed/partial（用户无权）时，其下所有文档不返回

## 错误码

| 错误码 | 说明 |
|--------|------|
| 401 | 非系统级 API Token 或 Token 无效 |
| 40001 | system_id、access_credential 或 query 为空，或解密失败 |
| 40003 | 用户不存在或无权访问该知识库 |

## 变更历史

- 2026-04-17: `top_k` 不传时默认 10（原为全部），硬上限 20；单 chunk content 超 800 rune 截断；响应新增 `truncated`、`content_length`、`content_truncated` 字段
- 2026-04-13: notes_id 改为 access_credential，使用 AES-256-GCM 加密传输
- 2026-04-07: 新增文档+父文件夹双层 visitable 权限过滤；仅接受系统级 API Token
- 2026-04-08: folder_id 改为 folder_ids（string[]），支持多文件夹搜索
- 2026-04-05: 新增 folder_id、node_ids 过滤参数；修复 Token KB 权限校验
