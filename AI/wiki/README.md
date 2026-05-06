# PandaWiki 文档

这是PandaWiki项目的文档中心，包含了项目的各个方面的详细说明。

## 📚 文档目录

### 🏗️ 开发相关

- **[开发文档](./development/)** — 完整的开发指南和最佳实践
  - [快速开始指南](./development/快速开始指南.md) — 10 分钟快速搭建开发环境
  - [本地启动后端服务](./development/本地启动后端服务.md)
  - [开发问题总结](./development/开发问题总结.md)
  - [知识库访问配置](./development/知识库访问配置指南.md)
  - [网络架构说明](./development/网络架构说明.md)
  - [构建说明](./development/构建说明.md)
  - [API 接口文档](./development/API接口文档.md)
  - [Wire 自动注册工具使用指南](./development/Wire自动注册工具使用指南.md)
  - [Consumer 服务配置优化说明](./development/Consumer服务配置优化说明.md)
  - [部署模式配置说明](./development/部署模式配置说明.md)

### 🚀 部署与运维

- [部署架构](./部署架构/)
- [版本合并](./版本合并/)
- [性能相关](./performance/)

### 📖 用户指南

- [用户使用说明](./user-guide/) — 7 大模块完整用户手册

### 🧭 项目内部资料（二次开发相关）

- [二开日志](./二开日志/) — 二次开发改动记录
- [功能分析](./功能分析/) / [功能分析日志](./功能分析日志/)
- [功能设计](./功能设计/)
- [方案和计划](./方案和计划/)
- [注意事项](./注意事项/)
- [管理台页面](./管理台页面/)
- [文件上传](./文件上传/)
- [组织和用户同步](./组织和用户同步/)

### 🔐 认证与集成

- [CAS 单点登录](./CAS/)
- [Agent Skill](./agent-skill/)

### 🛠️ 工具相关

- [Superpowers 工具集](./superpowers/)

## 🎯 项目概述

PandaWiki是一个AI驱动的开源知识库系统，具备以下特点：

- **AI辅助创作**: 智能化的内容生成和编辑
- **智能问答**: 基于RAG技术的知识检索
- **多租户支持**: 企业级的权限管理
- **微服务架构**: 高可用和可扩展的系统设计
- **现代化技术栈**: Go后端 + React/Next.js前端

## 🛠️ 技术栈

### 后端

- **语言**: Go 1.24.3
- **框架**: Echo v4
- **数据库**: PostgreSQL + Redis
- **消息队列**: NATS
- **对象存储**: MinIO
- **AI集成**: Eino框架支持多模型

### 前端

- **框架**: React 19 + Next.js 15
- **构建工具**: Vite 6
- **UI组件**: Material-UI 7
- **状态管理**: Redux Toolkit
- **富文本编辑**: TipTap

### 基础设施

- **容器化**: Docker + Docker Compose
- **反向代理**: Caddy/Nginx
- **向量数据库**: Qdrant
- **RAG服务**: RAGlite

## 📞 获取帮助

- [GitHub Issues](https://github.com/chaitin/PandaWiki/issues)
- [项目 Wiki](https://github.com/chaitin/PandaWiki/wiki)

---

*最后更新: 2026-04-24（重写文档索引，同步目录现状）*
