# Ollama API 接口文档

## 基本信息

- **服务地址**: `http://192.168.31.249:11434`
- **已安装模型**: gemma4:e4b (9.6GB)、qwen3:8b (5.2GB)、llama3:8b (4.7GB)
- **协议**: HTTP REST，默认流式响应

---

## 接口列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 健康检查 |
| GET | `/api/tags` | 获取模型列表 |
| POST | `/api/chat` | 多轮对话（推荐） |
| POST | `/api/generate` | 单轮文本生成 |
| POST | `/api/pull` | 拉取模型 |
| POST | `/api/delete` | 删除模型 |
| POST | `/api/show` | 查看模型信息 |
| POST | `/v1/chat/completions` | OpenAI 兼容接口 |

---

## 1. 健康检查

```
GET /
```

返回: `Ollama is running`

---

## 2. 模型列表

```
GET /api/tags
```

响应字段:
- models[].name: string — 模型名称
- models[].size: number — 模型大小（字节）
- models[].modified_at: string — 最后修改时间

---

## 3. 多轮对话（推荐）

```
POST /api/chat
```

### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| model | string | 是 | 模型名，如 `gemma4:e4b` |
| messages | array | 是 | 消息列表，格式同 OpenAI |
| stream | bool | 否 | 是否流式，默认 true |
| options | object | 否 | 模型参数 |

messages 格式:
- role: "system" / "user" / "assistant"
- content: string — 消息内容

### 非流式响应（stream: false）

| 字段 | 类型 | 说明 |
|------|------|------|
| model | string | 模型名 |
| message.role | string | 固定 "assistant" |
| message.content | string | 回复内容 |
| done | bool | 是否完成 |
| done_reason | string | 完成原因，如 "stop" |
| total_duration | number | 总耗时（纳秒） |
| prompt_eval_count | number | 输入 token 数 |
| eval_count | number | 输出 token 数 |

### 流式响应（stream: true / 默认）

逐行返回 JSON，每行一个 token 片段:
- `message.content` 为当前片段文本
- `done: false` 表示未结束
- 最后一行 `done: true`，包含统计信息

---

## 4. 单轮文本生成

```
POST /api/generate
```

### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| model | string | 是 | 模型名 |
| prompt | string | 是 | 输入文本 |
| stream | bool | 否 | 是否流式，默认 true |
| options | object | 否 | 模型参数 |

### 响应

| 字段 | 类型 | 说明 |
|------|------|------|
| response | string | 生成的文本 |
| done | bool | 是否完成 |

---

## 5. options 可用参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| temperature | float | 0.8 | 随机性，范围 0-2 |
| top_p | float | 0.9 | 核采样阈值，0-1 |
| top_k | int | 40 | Top-K 采样 |
| num_predict | int | 128 | 最大生成 token 数，-1 无限制 |
| stop | string[] | — | 停止词列表 |
| seed | int | — | 随机种子，固定可复现结果 |
| num_ctx | int | 2048 | 上下文窗口大小 |

---

## 6. OpenAI 兼容接口

```
POST /v1/chat/completions
```

请求和响应格式与 OpenAI API 一致，可直接用 OpenAI SDK 调用:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://192.168.31.249:11434/v1",
    api_key="ollama"  # 任意值即可
)

response = client.chat.completions.create(
    model="gemma4:e4b",
    messages=[{"role": "user", "content": "你好"}]
)
```

---

## 与 OpenAI API 对比

| 概念 | OpenAI | Ollama |
|------|--------|--------|
| 对话接口 | `/v1/chat/completions` | `/api/chat` |
| 模型列表 | `/v1/models` | `/api/tags` |
| 消息格式 | `messages[]` | 相同 |
| 流式控制 | `stream` 字段 | 相同 |
| 回复位置 | `choices[0].message` | `message` |
| 参数传递 | 顶层字段 | 放在 `options` 对象里 |
| 认证 | Bearer Token | 无需认证 |

---

## 注意事项

- 默认响应为流式（stream: true），需要完整响应时请显式传 `"stream": false`
- options 里的参数在 OpenAI 兼容接口中可直接放顶层
- Ollama 无需 API Key，局域网内可直接访问
- gemma4:e4b 单次推理约 30-40 秒（Mac Mini 本地推理）
