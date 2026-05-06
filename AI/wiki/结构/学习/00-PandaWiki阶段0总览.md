---
title: PandaWiki 阶段 0 总览（MOC）
tags:
  - pandawiki
  - 学习/阶段0
  - MOC
aliases:
  - 阶段0总览
  - PandaWiki骨架
created: '2026-04-25'
stage: 0-架构骨架
---
# PandaWiki 阶段 0 总览（MOC）

> 阶段 0 目标：在脑子里建立 PandaWiki 的"骨架"——五大子系统、各服务职责、六大业务域、关键约束。**不读代码，只读架构**。

## 阶段 0 自测 5 题

学完应能答出：

1. Admin 和 App 分别是啥、端口各多少、用户角色是谁 → [[Admin 与 App 前端]]
2. API 和 Consumer 为什么要拆、Consumer 在干啥 → [[Backend API 进程]] / [[Backend Consumer 进程]]
3. 一个 AI 问答请求从点击"发送"到拿到回答经过哪些组件 → [[AI 问答请求路径]]
4. PG / Redis / MinIO 的分工边界 → [[存储边界规则]]
5. 39 个 domain 的 6 个业务域各是什么、哪个最核心 → [[业务域总览]]

## 知识地图

### 架构层

- [[五大子系统]] — 前端 / 后端 / 存储 / 消息 / AI
- [[后端分层]] — handler / usecase / repo / domain / migration
- [[dev 模式与 local 模式]] — 三种部署形态的关键差异
- [[端口表]] — 所有服务的权威端口

### 服务层（每个服务做什么）

**前端**
- [[Admin 与 App 前端]]

**后端进程**
- [[Backend API 进程]]
- [[Backend Consumer 进程]]

**数据存储**
- [[PostgreSQL]] / [[Redis]] / [[MinIO]]

**消息**
- [[NATS]]

**AI 链路**
- [[Raglite]] / [[Qdrant]] / [[Ollama]] / [[Crawler]]

### 业务域（39 个 domain 的归类）

- [[业务域总览]]

### 流程（端到端）

- [[AI 问答请求路径]]
- [[存储边界规则]]

## 阶段 0 验收线

闭着眼睛能默写：
- ✅ 五大子系统及代表目录
- ✅ Admin 3000 / App 3010 / API 18000 三个本地端口
- ✅ 7 个基础容器及 13xxx 端口
- ✅ "PG 存元数据，Qdrant 存向量，MinIO 存文件"边界
- ✅ "API 接前台，Consumer 啃后台"分工
- ✅ 6 个业务域名字

## 阶段 1 入口

阶段 0 通过后，进入 [[阶段1-启动流程追踪]]：从 `backend/cmd/api/main.go` 读 Wire 装配。
