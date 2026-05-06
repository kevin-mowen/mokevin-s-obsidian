# 系统 API Token 与 access_credential 加密说明

## 功能描述

所有 OpenAPI 接口（`/api/v1/kb/*`）的用户身份参数使用加密传输，防止伪造用户身份。

## 加密内容

| 参数名               | 加密前（明文）                   | 加密后（密文）                   | 加密方式                   |
| ----------------- | ------------------------- | ------------------------- | ---------------------- |
| access_credential | 用户工号（notes_id，如 "015032"） | Base64 编码的 AES-256-GCM 密文 | 使用系统 Token 的 Secret 加密 |

## 涉及的密钥

| 名称               | 来源               | 用途                           |
| ---------------- | ---------------- | ---------------------------- |
| system_api_token | 创建系统 Token 时生成，需找管理员获取 | 放在 Authorization 头，认证调用方系统身份 |
| secret           | 创建系统 Token 时同步生成，需找管理员获取 | 用于加密/解密 access_credential    |

## 加密方式

- 算法: AES-256-GCM
- 密钥: 将 secret（64 字符 hex 字符串）解码为 32 字节作为密钥
- 加密: 生成 12 字节随机 nonce → AES-256-GCM 加密明文 → 拼接 nonce + 密文 + tag
- 编码: 对拼接结果做 Base64 编码，得到最终的 access_credential 字符串
- 每次加密结果不同（随机 nonce），均可正确解密

## 使用的接口

所有 `/api/v1/kb/*` 接口的 `access_credential` 参数均为加密后的用户工号：
- `/api/v1/kb/list`、`/api/v1/kb/chat`、`/api/v1/kb/search/documents`、`/api/v1/kb/search/chunks`、`/api/v1/kb/folders`、`/api/v1/kb/folder/docs`、`/api/v1/kb/upload`

## 变更历史

- 2026-04-13: notes_id 改为 access_credential，使用 AES-256-GCM 加密传输
