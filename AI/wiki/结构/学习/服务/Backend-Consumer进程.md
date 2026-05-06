---
title: Backend Consumer 进程
tags:
  - pandawiki
  - 学习/阶段0
  - 服务
  - 后端
aliases:
  - cmd/consumer
  - Consumer进程
  - 后台任务进程
created: '2026-04-25'
sources:
  - backend/cmd/consumer/main.go
  - backend/handler/mq/
---
# Backend Consumer 进程

> Backend 的"后厨大师傅"——订阅 [[NATS]] 消息做异步慢活，**不开 HTTP 端口**，可以独立扩容/重启。

## 基本信息

- **入口**：`backend/cmd/consumer/main.go`
- **启动**：`go run ./cmd/consumer`（dev 模式由 `dev-services-cl.sh` 选 8）
- **端口**：**无**（只订阅 NATS）
- **进程检测**：`pgrep -f 'go-build.*consumer'`

## 主要任务

| 任务 | 触发源 | 大致耗时 |
|---|---|---|
| 文档学习（向量化） | API 上传/编辑文档后发 NATS | 数秒～数十分钟 |
| 爬虫回调入库 | [[Crawler]] 抓完发 NATS | 秒级 |
| CUC 组织架构同步 | 定时器 + 手动触发 | 分钟级 |
| 统计聚合 | 定时器 | 分钟级 |
| 文件导入解析 | API 收到上传后发 NATS | 取决于文件大小 |

## 为什么要拆出来

举例：用户上传 10 MB 的 Markdown：
- 没拆：API 调 raglite 学习卡 20 分钟，期间所有用户的访问都排队
- 拆开：API 写 MinIO + 发 NATS → 立即返回 → Consumer 慢慢学

详见 MEMORY 的"大文档 RAG 学习失败"。

## handler/mq/ 目录

Consumer 进程里的"路由"是 NATS subject 而不是 HTTP path：

```
handler/mq/node_release.go   # node 学习
handler/mq/crawler.go        # 爬虫回调
handler/mq/cuc_sync.go       # CUC 同步
...
```

每个文件订阅一个 subject 名。

## 易错点

- ❌ 在 Consumer 里写 HTTP 路由 → 它没开端口，只能订阅消息
- ❌ 在 API 进程里直接调 raglite 学习 → 必须发 NATS 给 Consumer 干

## source_quote

```
backend/cmd/consumer/main.go         # 进程入口
backend/handler/mq/                  # 订阅器集合
backend/usecase/                     # 共享 usecase（与 API 共用）
```

## 关联

[[Backend API 进程]] · [[NATS]] · [[Raglite]] · [[Crawler]]
