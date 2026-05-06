---
title: Crawler
tags:
  - pandawiki
  - 学习/阶段0
  - 服务
  - 爬虫
aliases:
  - 爬虫服务
created: '2026-04-25'
sources:
  - backend/usecase/crawler.go
  - backend/handler/mq/
  - docker/dev/docker-compose.crawler.yml
---
# Crawler

> 长亭自研的网页抓取服务（独立容器）。处理"URL 导入 / Sitemap / RSS"等场景。

## 基本信息

- **容器**：`panda-wiki-crawler`
- **端口**：`dev.localhost:13800`
- **协议**：HTTP

## 工作流

```
① 用户在 Admin 输入 URL / sitemap.xml
   ↓
② Backend API 调 Crawler 提交任务
   ↓
③ Crawler 异步抓取 → 抓完后发 NATS 消息
   ↓
④ Backend Consumer (handler/mq/crawler.go) 收到
   ↓
⑤ 转换 + 入库为 node
   ↓
⑥ 触发 node.release → raglite 学习
```

## 它做什么

- HTTP 抓取（含动态渲染）
- HTML → Markdown 转换
- 处理 Sitemap.xml
- 处理 RSS

## 它不做什么

- ❌ Word/PDF 解析 → 那是 doc2md / markitdown 的活
- ❌ 直接学习内容 → 学习是 [[Raglite]] 的活

## 与 doc2md 的边界

| 来源 | 由谁处理 |
|---|---|
| 网页 URL / Sitemap / RSS | **Crawler** |
| 上传 .docx / .pdf / .pptx | **doc2md / markitdown**（宿主机 :8490） |
| 上传 .md / .txt | Backend 直接读，无需中间服务 |

## 配置

```yaml
# config.local.yml
crawler:
  host: 'dev.localhost'  # Docker 环境为 panda-wiki-crawler
  port: 13800
```

## source_quote

```
backend/usecase/crawler.go              # 调用封装（44k 大文件）
backend/handler/mq/crawler.go           # 抓完后的回调入库
docker/dev/docker-compose.crawler.yml   # 容器定义
```

## 关联

[[NATS]] · [[Backend Consumer 进程]] · [[业务域总览|内容接入域]]
