---
created: '2026-03-08'
tags:
  - pandawiki
  - raglite
  - docker
  - deployment
status: active
---
# Raglite v2.x 升级 - Docker-Compose 修改清单

> 记录 raglite 从 v1.x 升级到 v2.x 时，各环境 docker-compose 文件需要的修改。

## 一、生产文件 `docker/docker-compose.yml` 具体改动

### 改动 1：postgres 镜像（L81）

```yaml
# 旧:
image: chaitin-registry.cn-hangzhou.cr.aliyuncs.com/chaitin/panda-wiki-postgres:17.5
# 新:
image: chaitin-registry.cn-hangzhou.cr.aliyuncs.com/chaitin/postgres-zhparser:17.6-bookworm
```

> 镜像名从 `panda-wiki-postgres` 改为 `postgres-zhparser`，版本从 `17.5` 升到 `17.6-bookworm`。上游统一了镜像命名。

### 改动 2：raglite 服务（L159-177）

```yaml
# ═══════════════════════════════════════════════════
# 旧 (v1.x):
# ═══════════════════════════════════════════════════
  raglite:
    image: .../panda-wiki-raglite:1-4-1
    environment:
      - GIN_MODE=release
      - DATABASE_HOST=panda-wiki-postgres
      - DATABASE_USER=panda-wiki
      - DATABASE_PASSWORD=${POSTGRES_PASSWORD}
      - MINIO_HOST=panda-wiki-minio:9000
      - MINIO_USER=s3panda-wiki
      - MINIO_PASSWORD=${S3_SECRET_KEY}
      - QDRANT_HOST=panda-wiki-qdrant
      - QDRANT_API_KEY=${QDRANT_API_KEY}
      - MQ_NATS_URL=nats://panda-wiki-nats:4222
      - MQ_NATS_USER=panda-wiki
      - MQ_NATS_PASSWORD=${NATS_PASSWORD}

# ═══════════════════════════════════════════════════
# 新 (v2.x):
# ═══════════════════════════════════════════════════
  raglite:
    image: .../raglite:v2.15.1
    environment:
      - GIN_MODE=release
      - DATABASE_POSTGRESQL_HOST=panda-wiki-postgres
      - DATABASE_POSTGRESQL_PORT=5432
      - DATABASE_POSTGRESQL_USER=panda-wiki
      - DATABASE_POSTGRESQL_PASSWORD=${POSTGRES_PASSWORD}
      - DATABASE_QDRANT_HOST=panda-wiki-qdrant
      - DATABASE_QDRANT_PORT=6333
      - DATABASE_QDRANT_API_KEY=${QDRANT_API_KEY}
      - STORAGE_MINIO_ENDPOINT=panda-wiki-minio:9000
      - STORAGE_MINIO_ACCESS_KEY_ID=s3panda-wiki
      - STORAGE_MINIO_SECRET_ACCESS_KEY=${S3_SECRET_KEY}
      - NATS_URL=nats://panda-wiki-nats:4222
      - NATS_USER=panda-wiki
      - NATS_PASSWORD=${NATS_PASSWORD}
```

> **注意**：不需要配 `SERVER_PORT`。后端 `config.go:155` 默认连 `:5050`，raglite v2.x 默认也监听 `5050`，两边对齐，无需额外配置。

## 二、环境变量详解

### 保持不变

| 变量 | 值 | 说明 |
|------|-----|------|
| `GIN_MODE` | `release` | Gin 框架运行模式，关闭调试日志 |

### PostgreSQL 连接（数据库）

| v1.x 旧变量            | v2.x 新变量                       | 值（生产）                  | 说明                             |
| ------------------- | ------------------------------ | ---------------------- | ------------------------------ |
| `DATABASE_HOST`     | `DATABASE_POSTGRESQL_HOST`     | `panda-wiki-postgres`  | PG 主机地址（容器名）                   |
| *(无)*               | `DATABASE_POSTGRESQL_PORT`     | `5432`                 | PG 端口，v1.x 硬编码 5432，v2.x 需显式指定 |
| `DATABASE_USER`     | `DATABASE_POSTGRESQL_USER`     | `panda-wiki`           | PG 用户名                         |
| `DATABASE_PASSWORD` | `DATABASE_POSTGRESQL_PASSWORD` | `${POSTGRES_PASSWORD}` | PG 密码，从 `.env` 读取              |

### Qdrant 连接（向量数据库，用于 embedding 存储和检索）

| v1.x 旧变量         | v2.x 新变量                  | 值（生产）               | 说明                                     |
| ---------------- | ------------------------- | ------------------- | -------------------------------------- |
| `QDRANT_HOST`    | `DATABASE_QDRANT_HOST`    | `panda-wiki-qdrant` | Qdrant 主机地址                            |
| *(无)*            | `DATABASE_QDRANT_PORT`    | `6333`              | Qdrant HTTP API 端口，v1.x 硬编码，v2.x 需显式指定 |
| `QDRANT_API_KEY` | `DATABASE_QDRANT_API_KEY` | `${QDRANT_API_KEY}` | Qdrant 认证密钥                            |

### MinIO 连接（对象存储，用于文件/文档存储）

| v1.x 旧变量         | v2.x 新变量                          | 值（生产）                   | 说明                               |
| ---------------- | --------------------------------- | ----------------------- | -------------------------------- |
| `MINIO_HOST`     | `STORAGE_MINIO_ENDPOINT`          | `panda-wiki-minio:9000` | MinIO 地址，v2.x 合并 host+port 为一个字段 |
| `MINIO_USER`     | `STORAGE_MINIO_ACCESS_KEY_ID`     | `s3panda-wiki`          | MinIO 访问密钥（S3 兼容 AccessKey）      |
| `MINIO_PASSWORD` | `STORAGE_MINIO_SECRET_ACCESS_KEY` | `${S3_SECRET_KEY}`      | MinIO 秘密密钥（S3 兼容 SecretKey）      |

### NATS 连接（消息队列，用于异步任务分发）

| v1.x 旧变量           | v2.x 新变量        | 值（生产）                         | 说明         |
| ------------------ | --------------- | ----------------------------- | ---------- |
| `MQ_NATS_URL`      | `NATS_URL`      | `nats://panda-wiki-nats:4222` | NATS 服务地址  |
| `MQ_NATS_USER`     | `NATS_USER`     | `panda-wiki`                  | NATS 认证用户名 |
| `MQ_NATS_PASSWORD` | `NATS_PASSWORD` | `${NATS_PASSWORD}`            | NATS 认证密码  |

### 关于 `SERVER_PORT`

| 场景 | 是否需要配 | 原因 |
|------|-----------|------|
| **生产环境** (`docker/docker-compose.yml`) | **不需要** | 后端 `config.go` 默认连 `:5050`，raglite v2.x 默认监听 `5050`，自动对齐 |
| **dev 环境** | **配了 `8080`** | dev 通过宿主机端口映射 `13400:8080`，容器内需监听 8080 |



