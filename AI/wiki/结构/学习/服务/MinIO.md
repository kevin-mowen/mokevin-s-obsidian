---
title: MinIO
tags:
  - pandawiki
  - 学习/阶段0
  - 服务
  - 存储
aliases:
  - S3
  - 对象存储
created: '2026-04-25'
sources:
  - backend/usecase/file.go
  - docker/dev/docker-compose.minio.yml
---
# MinIO

> **文件**就放它。S3 兼容协议。

## 基本信息

- **容器**：`panda-wiki-minio`
- **S3 端口**：`dev.localhost:13600`
- **控制台**：`http://dev.localhost:13601`
- **access_key**：`s3panda-wiki`
- **bucket**：基本就叫 `panda-wiki`

## 它存什么

| 类别 | 例子 |
|---|---|
| 用户上传文档原始文件 | `.md` `.docx` `.pdf` `.zip` |
| 爬虫抓的网页快照 | `.html` |
| 用户头像 | `.jpg` `.png` |
| 知识库 logo / icon | 同上 |
| 文档导出产物 | `.pdf`（导出生成） |
| 转换中间产物 | doc2md 临时文件 |

## 它不存什么

- ❌ 文件元数据（名字、大小、上传者、所属 node）→ [[PostgreSQL]]
- ❌ 文件向量 → [[Qdrant]]

## 与 PG 的关系

```
PG.nodes 表          MinIO 桶
─────────            ─────────
id: 123              s3://panda-wiki/docs/123.md
file_url: s3://...   ↑
                     │
                  指向同一个文件
```

PG 存"指针"，MinIO 存"数据"。

## 连接参数

```yaml
# config.local.yml
s3:
  endpoint: 'dev.localhost:13600'
  access_key: 's3panda-wiki'
  secret_key: 'panda_wiki_local_2025'
```

## 在 dev 模式的特殊用法

`config.local.yml` 里 `nginx_base_url: 'http://dev.localhost:13600'` —— **静态文件直接指向 MinIO**（生产模式经过 Nginx）。

## source_quote

```
backend/usecase/file.go               # 文件上传/下载
backend/store/                        # S3 client
docker/dev/docker-compose.minio.yml   # 容器定义
```

## 关联

[[存储边界规则]] · [[PostgreSQL]] · [[Redis]]
