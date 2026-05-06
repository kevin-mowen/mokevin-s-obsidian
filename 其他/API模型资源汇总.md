---
tags:
  - api
  - 模型
  - 配置
created: '2026-03-08'
updated: '2026-03-08'
---
# API 模型资源汇总

> 更新时间：2026-03-08

---

## 1. DeepSeek（官方直连）

| 项目 | 值 |
|------|------|
| Base URL | `https://api.deepseek.com/v1` |
| API Key 1 | `sk-93bb8512a21046b983ca948742b7d390`（OPENAI_API_KEY） |
| API Key 2 | `sk-c52c2af63763438ab6175ced929f578a`（DEEPSEEK_API_KEY） |
| 可用模型 | `deepseek-chat`、`deepseek-reasoner` |
| 用途 | Chat / 推理 |
| 备注 | 环境变量 `OPENAI_BASE_URL` 默认指向此地址 |

---

## 2. AIHubMix（多模型路由）

| 项目 | 值 |
|------|------|
| Base URL | 需根据文档配置 |
| API Key | `sk-4i77lntfTcGQIu8K0cC304A125524f7dB5FaE60011353cAc` |
| 可用模型 | 支持 OpenAI / Claude / Gemini 等多模型路由 |
| 用途 | Chat / Embedding / 多用途 |
| 备注 | 环境变量 `AIHUBMIX_API_KEY` |

---

## 3. MiniMax（Claude Code 中转）

| 项目 | 值 |
|------|------|
| Base URL | `https://api.minimaxi.com/anthropic` |
| API Key | `sk-cp-nHelZmvBfLfMlhCHzK9En1Yq5vFJyLTwKSCwRIE1Yrz44QHch6elZt4BMPU9BRVyjrXlB8dfmEnGnHC7gPCjarWhB7qDliHwvssOUr9qkHVejMWDYEd3R0Q` |
| 可用模型 | `MiniMax-M2.5` |
| 用途 | Claude Code（`claude-mm` 命令） |
| 启动命令 | `claude-mm` |

---

## 4. NewAPI（Claude Code 中转）

| 项目 | 值 |
|------|------|
| Base URL | `https://ai.xingyungept.cn` |
| API Key | `sk-z9yQCkZavDn62fe1bjukpTlQL6YghcecMWaC2k3nvPUZQZHT` |
| 可用模型 | `gpt-5.4` |
| 用途 | Claude Code（`claude-new` 命令） |
| 启动命令 | `claude-new` |

---

## 5. GPT 中转（Claude Code 中转）

| 项目 | 值 |
|------|------|
| Base URL | `https://api.268526.eu.cc` |
| API Key | `sk-N0RtVvKqubIOrDifDreyBRKNjK16KeCd4726rzmzy1qroial` |
| 可用模型 | `gpt-5.4` |
| 用途 | Claude Code（`claude-gpt` 命令） |
| 启动命令 | `claude-gpt` |

---

## 6. AnyAPI（Claude Code 中转）

| 项目 | 值 |
|------|------|
| Base URL | `https://a-ocnfniawgw.cn-shanghai.fcapp.run` |
| API Key | `sk-3if5wUDu5ycKMkA81DGQp7UwwrQixRGlqLTJCMHmlqK44MH4` |
| 可用模型 | `claude-opus-4-6` |
| 用途 | Claude Code（`claude-any` 命令） |
| 启动命令 | `claude-any` |

---

## 7. Tumuer Router（Embedding / Rerank 专用）

| 项目 | 值 |
|------|------|
| Base URL | `https://router.tumuer.me/v1` |
| API Key | `sk-wZYicfw9JWX3rw6RU8lBJOgdOpE7Axp6DZ5S4fk8sg6NMQB0` |
| 用途 | Embedding、Rerank（PandaWiki 项目使用） |

### 已验证可用的 Embedding 模型

| 模型名称 | 向量维度 | 输入价格 | 输出价格 | 状态 |
|---------|---------|---------|---------|------|
| `BAAI/bge-m3` | 1024 | 免费 | 免费 | ✅ 已验证 |
| `text-embedding-3-small` | 1536 | $0.0200/M | $0.0200/M | ✅ 已验证 |
| `openai/text-embedding-3-large` | 3072 | $0.2000/M | $0.2000/M | ✅ 已验证 |

### 已验证可用的 Rerank 模型

| 模型名称 | 输入价格 | 输出价格 | 状态 |
|---------|---------|---------|------|
| `Pro/BAAI/bge-reranker-v2-m3` | $0.0640/M | $0.0640/M | ✅ 已验证 |

### 其他可用模型（未测试）

#### Embedding 模型

| 模型名称 | 输入价格 | 输出价格 | 备注 |
|---------|---------|---------|------|
| `google/gemini-embedding-001` | $0.1300/M | $0.1300/M | Google |
| `nv-dinov2` | 免费 | 免费 | NVIDIA |
| `openai/gpt-oss-120b:free` | 免费 | 免费 | |
| `openai/gpt-oss-20b:free` | 免费 | 免费 | |
| `Pro/BAAI/bge-m3` | $0.1400/M | $0.1400/M | bge-m3 付费版 |
| `Qwen/Qwen3-Embedding-0.6B` | $0.0320/M | $0.0320/M | |
| `Qwen/Qwen3-Embedding-4B` | $0.0640/M | $0.0640/M | 开源权重 32K |
| `Qwen/Qwen3-Embedding-8B` | $0.1300/M | $0.1300/M | 开源权重 32K |
| `text-embedding-v1` | $0.1000/M | $0.1000/M | 阿里云百炼 |
| `text-embedding-v2` | $0.1300/M | $0.1300/M | 阿里云百炼 |
| `text-embedding-v3` | $0.1300/M | $0.1300/M | 阿里云百炼 |
| `text-embedding-v4` | $0.1300/M | $0.1300/M | 阿里云百炼 |

#### Rerank 模型

| 模型名称 | 输入价格 | 输出价格 | 备注 |
|---------|---------|---------|------|
| `Qwen/Qwen3-Reranker-4B` | $0.0640/M | $0.0640/M | |
| `Qwen/Qwen3-Reranker-8B` | $0.1300/M | $0.1300/M | |

---

## 快速参考

### PandaWiki 模型配置

```yaml
# Embedding
API 地址: https://router.tumuer.me/v1
模型名称: BAAI/bge-m3
API Key:  sk-wZYicfw9JWX3rw6RU8lBJOgdOpE7Axp6DZ5S4fk8sg6NMQB0

# Rerank
API 地址: https://router.tumuer.me/v1
模型名称: Pro/BAAI/bge-reranker-v2-m3
API Key:  sk-wZYicfw9JWX3rw6RU8lBJOgdOpE7Axp6DZ5S4fk8sg6NMQB0
```

### Claude Code 快捷命令

| 命令           | 服务商          | 模型              |
| ------------ | ------------ | --------------- |
| `claude`     | Anthropic 官方 | claude-opus-4-6 |
| `claude-mm`  | MiniMax      | MiniMax-M2.5    |
| `claude-new` | NewAPI       | gpt-5.4         |
| `claude-gpt` | GPT中转        | gpt-5.4         |
| `claude-any` | AnyAPI       | claude-opus-4-6 |
