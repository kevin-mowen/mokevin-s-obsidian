---
title: Ollama
tags:
  - pandawiki
  - 学习/阶段0
  - 服务
  - AI
  - LLM
aliases:
  - 本地模型
  - 模型运行时
created: '2026-04-25'
sources: []
---
# Ollama

> 本地模型运行时，跑在**宿主机**（不是容器）。负责真正的 embedding / chat 推理。

## 基本信息

- **位置**：宿主机 macOS 应用
- **端口**：`http://localhost:11434`（容器里通过 `host.docker.internal:11434` 访问）
- **协议**：OpenAI 兼容

## 在 PandaWiki 链路里的位置

```
Backend ──→ Raglite ──→ Ollama (embedding + analysis)
                  └──→ one-api ──→ 云端 chat 模型（glm-5.1）
```

PandaWiki **自己不直接调 Ollama**，全部经 [[Raglite]] 中转。

## 当前模型配置（raglite_v2.ai_models 表）

| 角色 | 模型 | 调用地址 |
|---|---|---|
| embedding | `BAAI/bge-m3` | `host.docker.internal:11434/v1` |
| analysis | `qwen2.5:7b`（换掉了 ctx 太小的 gemma4:e4b） | 同上 |
| chat | `glm-5.1` | `localhost:3002/v1`（one-api） |

## 关键环境变量（已用 launchctl setenv 设置）

```bash
OLLAMA_NUM_PARALLEL=8       # 并发请求槽位
MAX_LOADED_MODELS=3         # 同时载入的模型数
KEEP_ALIVE=30m              # 模型保活时间
```

⚠️ **重启 mac 会丢**，建议写到 `~/.zshrc` 或 LaunchAgent plist。

## 易错点

- ❌ 以为 Ollama 在容器里：它在宿主机
- ❌ 容器内用 `localhost:11434` 访问 → 应是 `host.docker.internal:11434`
- ❌ 单任务批量打 Ollama 跑不满：raglite 单任务硬编码 2 goroutine（见 [[Raglite]]）

## one-api 网关

`one-api`（端口 3002 或 4000）是宿主机上的 OpenAI 协议聚合网关，把 `glm-5.1` 这种云端模型暴露成 OpenAI 格式给 raglite 的 chat 角色用。

## source_quote

```
（Ollama 本身不在 PandaWiki 仓库内，配置在 raglite 容器中）
docker/dev/docker-compose.raglite.yml  # 通过 host.docker.internal 访问
```

## 关联

[[Raglite]] · [[Qdrant]] · [[AI 问答请求路径]]
