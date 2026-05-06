# AI 问答

## 功能描述

基于用户有权限的知识库文档，使用 AI 对用户问题进行问答。支持流式（SSE）和非流式两种模式，支持多轮对话。用户身份通过 AES-256-GCM 加密的 access_credential 传输。

## API 接口

| 方法 | 路径 |
|------|------|
| POST | `/api/v1/kb/chat` |

## 请求头

| Header        | 必填  | 说明                   |
| ------------- | --- | -------------------- |
| Authorization | 是   | `Bearer <system_api_token>`，仅支持系统级 API Token（在系统配置 → 系统 API Token 中创建），KB 级别 Token 不可用。Token 需找管理员获取 |
| Content-Type  | 是   | `application/json`   |

## 请求参数

| 参数                | 类型       | 必填  | 说明                                                               | 示例                 |
| ----------------- | -------- | --- | ---------------------------------------------------------------- | ------------------ |
| system_id         | string   | 是   | 调用方系统编号                                                          | `"fastgpt"`        |
| agent_id          | string   | 否   | 智能体 ID                                                           | `"bot_12345"`      |
| access_credential | string   | 是   | 使用 notes_id + Secret 经 AES-256-GCM 加密后的 Base64 密文，Secret 需找管理员获取 | `"nGhJ8kL2mN..."`  |
| query             | string   | 是   | 用户问题                                                             | `"如何配置数据库连接？"`     |
| kb_ids            | string[] | 否   | 限定知识库范围，不传则搜全部知识库                                                | `["3adce2bd-..."]` |
| folder_ids        | string[] | 否   | 只基于指定文件夹下的文档问答，支持多个                                              | `["aaa-bbb-ccc"]`  |
| doc_ids           | string[] | 否   | 只基于指定文档问答                                                        | `["019b6e86-..."]` |
| stream            | boolean  | 否   | 是否流式返回，默认 false                                                  | `true`             |
| conversation_id   | string   | 否   | 续接会话时传入（首次不传）                                                    | `"019b..."`        |
| nonce             | string   | 否   | 续接会话时必传上次返回的 nonce                                               | `"a1b2c3..."`      |

## 调用示例

```bash
# 非流式
curl -s -X POST http://localhost:18000/api/v1/kb/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <system_api_token>" \
  -d '{
    "system_id": "fastgpt",
    "access_credential": "<AES-256-GCM加密后的Base64密文>",
    "query": "二月三月的计划",
    "stream": false
  }' | jq

# 流式（SSE）
curl -X POST http://localhost:18000/api/v1/kb/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <system_api_token>" \
  -d '{
    "system_id": "Z046X0",
    "access_credential": "<AES-256-GCM加密后的Base64密文>",
    "query": "测试",
    "stream": true
  }'
```

## 成功响应 — 非流式 (stream=false)

```json
{
  "success": true,
  "code": 0,
  "message": "success",
  "data": {
    "answer": "数据库连接配置方法如下：...",
    "thinking": "模型的思考过程...",
    "conversation_id": "019b6e86-xxxx-...",
    "nonce": "a1b2c3d4-xxxx-...",
    "message_id": "e5f6g7h8-xxxx-...",
    "references_total": 12,
    "references_truncated": true,
    "references": [
      {
        "doc_id": "019b6e86-...",
        "doc_name": "数据库配置指南",
        "summary": "...",
        "summary_truncated": false,
        "doc_url": "http://...",
        "kb_id": "3adce2bd-...",
        "kb_name": "技术文档库"
      }
    ]
  }
}
```

### 非流式响应字段

| 字段                         | 类型     | 说明                                     |
| -------------------------- | ------ | -------------------------------------- |
| data.answer                | string | AI 正文回答（不含思考内容）                        |
| data.thinking              | string | 模型思考过程（推理模型如 DeepSeek-R1 才有，普通模型为空不返回） |
| data.conversation_id       | string | 会话 ID，续接对话时回传                          |
| data.nonce                 | string | 会话随机数，续接对话时回传                          |
| data.message_id            | string | 本次消息 ID                                |
| data.references            | array  | 回答中实际引用的文档列表（最多 10 条） |
| data.references_total      | int    | 截断前的引用文档总数                             |
| data.references_truncated  | bool   | references 是否因数量或 summary 被截断          |
| data.references[].doc_id   | string | 引用文档 ID                                |
| data.references[].doc_name | string | 引用文档名称                                 |
| data.references[].summary  | string | 引用文档摘要（超 200 rune 会被截断）                |
| data.references[].summary_truncated | bool | summary 是否被截断 |
| data.references[].doc_url  | string | 引用文档链接                                 |
| data.references[].kb_id    | string | 所属知识库 ID                               |
| data.references[].kb_name  | string | 所属知识库名称                                |

## 成功响应 — 流式 (stream=true)

Content-Type: `text/event-stream`

```
data: {"type":"conversation_id","content":"019b6e86-xxxx..."}
data: {"type":"nonce","content":"a1b2c3d4-xxxx..."}
data: {"type":"message_id","content":"e5f6g7h8-xxxx..."}
data: {"type":"reference","reference":{"doc_id":"...","doc_name":"...","summary":"...","doc_url":"...","kb_id":"...","kb_name":"..."}}
data: {"type":"thinking","content":"让我分析一下..."}
data: {"type":"data","content":"数据库"}
data: {"type":"data","content":"连接配置方法如下..."}
data: {"type":"reference_truncated","content":"12"}
data: {"type":"done","content":""}
```

### 流式事件类型

| type            | 说明                 |
| --------------- | ------------------ |
| conversation_id | 会话 ID              |
| nonce           | 会话随机数              |
| message_id      | 消息 ID              |
| reference       | 引用文档（最多推送 10 条，字段与非流式 references 一致：doc_id、doc_name、summary、doc_url、kb_id、kb_name；summary 超 200 rune 被截断） |
| reference_truncated | references 被截断标志，content 为截断前的总条数。仅当有被截断时发送，位于 done 之前 |
| thinking        | 模型思考片段（推理模型才有，拼接即为完整思考过程） |
| data            | AI 回答正文片段，拼接即为完整回答 |
| error           | 错误信息，之后不再有事件       |
| done            | 结束标记               |

## 限制规则

- `references` 最多返回 10 条（第 11 条起丢弃）
- 每条 `summary` 超 200 rune 截断
- 获取完整引用文档内容：通过 `doc_id` 调 `/api/v1/kb/doc/detail` 接口

## 权限过滤

RAG 搜索结果会经过双层权限过滤后再送入 AI 生成回答：
1. **文档自身** answerable 权限：closed 的文档不参与问答，partial 的文档只有授权用户可用
2. **父文件夹** visitable 权限：父文件夹为 closed/partial（用户无权）时，其下所有文档不参与问答

## 错误码

| 错误码 | 说明 |
|--------|------|
| 401 | 非系统级 API Token 或 Token 无效 |
| 40001 | system_id、access_credential 或 query 为空，或解密失败 |
| 40003 | 用户不存在或无权访问该知识库 |
| 50001 | 服务器内部错误 |

## 变更历史

- 2026-04-17: references 数量上限 10 条，summary 超 200 rune 截断；非流式响应新增 `references_total`、`references_truncated` 字段，每条引用新增 `summary_truncated`；流式新增 `reference_truncated` 事件类型
- 2026-04-13: notes_id 改为 access_credential，使用 AES-256-GCM 加密传输
- 2026-04-07: 非流式响应新增 thinking 字段，answer 与 think 分离；流式新增 thinking 事件类型；引用文档事件改为 reference；新增父文件夹权限过滤
- 2026-04-07: 仅接受系统级 API Token 认证
- 2026-04-08: folder_id 改为 folder_ids（string[]），支持多文件夹；统一流式/非流式引用字段
