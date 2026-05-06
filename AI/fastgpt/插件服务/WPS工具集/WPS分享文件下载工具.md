---
tags:
  - fastgpt
  - plugin
  - wps
  - api-doc
created: '2026-04-07'
tool: wpsGetDownloadUrlByShareFile
---
# WPS 分享文件下载工具

## 功能描述
通过 WPS 分享链接获取文件下载地址。用户输入包含 WPS 分享链接的文本，工具自动完成认证并返回可用的下载 URL。

## 功能特性
- 从用户输入中自动提取 WPS 分享链接
- SM2 非对称加密保障用户身份安全传输
- KSO-1 HMAC-SHA256 签名认证 WPS OpenAPI
- Bearer Token 鉴权后续接口请求
- 完整的错误信息返回

## 实现文件

### 工具入口
- `modules/tool/packages/wpsInteract/index.ts` - 工具集入口
- `modules/tool/packages/wpsInteract/config.ts` - 工具集配置

### 子工具：wpsGetDownloadUrlByShareFile
- `children/wpsGetDownloadUrlByShareFile/config.ts` - 工具配置与类型定义
- `children/wpsGetDownloadUrlByShareFile/src/index.ts` - 核心业务逻辑
- `children/wpsGetDownloadUrlByShareFile/index.ts` - 子工具入口
- `children/wpsGetDownloadUrlByShareFile/test/index.test.ts` - 测试用例

## 数据结构

### 输入 (InputType)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| userInput | string | 是 | 包含 WPS 分享链接的文本，需含 `weboffice.cib.com.cn/weboffice/l/` 关键字 |

### 输出 (OutputType)
| 字段 | 类型 | 说明 |
|------|------|------|
| result | string | 成功返回下载 URL；失败返回错误描述 |

## API 接口

工具内部依次调用 4 个外部接口：

### 接口 1：SM2 加密
| 项目 | 内容 |
|------|------|
| 方法 | POST |
| 地址 | `http://20.201.9.111:8180/api/sm2/encrypt` |
| Content-Type | application/json |

**请求体：**
| 字段 | 类型 | 说明 |
|------|------|------|
| plaintext | string | Base64 编码的 JSON 字符串，内含 `timestamp`（当前毫秒时间戳）和 `notes_id`（用户名） |
| publicKey | string | 固定 SM2 公钥 |

**响应体：**
| 字段 | 类型 | 说明 |
|------|------|------|
| ciphertext | string | SM2 加密后的密文 |

---

### 接口 2：获取 Access Token
| 项目 | 内容 |
|------|------|
| 方法 | POST |
| 地址 | `https://weboffice.cib.com.cn/c/ciblogin/api/v1/getUserInfoForAIOp` |
| Content-Type | application/json |

**请求体：**
| 字段 | 类型 | 说明 |
|------|------|------|
| data | string | 接口 1 返回的 ciphertext |

**响应体：**
| 字段 | 类型 | 说明 |
|------|------|------|
| data.token.access_token | string | 用于后续接口鉴权的 Bearer Token |

---

### 接口 3：获取分享文件详情
| 项目 | 内容 |
|------|------|
| 方法 | GET |
| 地址 | `https://weboffice.cib.com.cn/openapi/v7/links/{shareFileId}/meta` |

**请求头：**
| Header | 说明 |
|--------|------|
| X-Kso-Date | RFC2822 格式时间 |
| X-Kso-Authorization | `KSO-1 {APP_ID}:{HMAC-SHA256签名}` |
| Authorization | `Bearer {access_token}` |

**响应体：**
| 字段 | 类型 | 说明 |
|------|------|------|
| data.drive_id | string | 云盘 ID |
| data.file_id | string | 文件 ID |

---

### 接口 4：获取下载链接
| 项目 | 内容 |
|------|------|
| 方法 | GET |
| 地址 | `https://weboffice.cib.com.cn/openapi/v7/drives/{driveId}/files/{fileId}/download?with_hash=true` |

**请求头：**（同接口 3）

**响应体（成功）：**
| 字段 | 类型 | 说明 |
|------|------|------|
| data.url | string | 文件下载地址 |

**响应体（失败）：**
| 字段 | 类型 | 说明 |
|------|------|------|
| msg | string | 错误信息 |

## 认证机制

### 三层认证
| 层级 | 机制 | 用途 |
|------|------|------|
| Layer 1 | SM2 非对称加密 | 加密 `{timestamp, notes_id}` 进行用户身份安全传输 |
| Layer 2 | Bearer Token | `getUserInfoForAIOp` 返回的 access_token，用于后续接口鉴权 |
| Layer 3 | KSO-1 签名 | HMAC-SHA256 签名（`method + uri + contentType + date + bodyHash`），用于 WPS OpenAPI 请求认证 |

### KSO-1 签名生成步骤
1. 计算请求体的 SHA256 哈希（无请求体则为空字符串的哈希）
2. 拼接签名字符串：`KSO-1 + method + uri + contentType + ksoDate + sha256Hex`
3. 使用 APP_KEY 作为密钥计算 HMAC-SHA256
4. 生成 Authorization 头：`KSO-1 {APP_ID}:{签名hex}`

## 固定配置
| 配置项 | 值 | 说明 |
|--------|-----|------|
| APP_ID | VIGEKDPAZAWRRFXK | WPS OpenAPI 应用 ID |
| APP_KEY | SKmizelipfjracld | WPS OpenAPI 签名密钥 |
| YUNDOC_URL | `https://weboffice.cib.com.cn` | WPS 云文档地址 |
| CIPHER_URL | `http://20.201.9.111:8180` | SM2 加密服务地址 |
| SM2 公钥 | `BL+htj+HB2hpBW8...iB0=` | SM2 加密公钥 |

## 执行流程

```
用户输入文本
    │
    ▼
正则提取 shareFileId ──失败──▶ 返回错误
    │
    ▼
SM2 加密用户信息 (接口1) ──失败──▶ 返回错误
    │
    ▼
获取 access_token (接口2) ──失败──▶ 返回错误
    │
    ▼
获取文件 drive_id/file_id (接口3) ──失败──▶ 返回错误
    │
    ▼
获取下载链接 (接口4) ──失败──▶ 返回错误
    │
    ▼
返回下载 URL
```

## 依赖关系
- 上游依赖：SM2 加密服务（内网 20.201.9.111:8180）、WPS 云文档 OpenAPI、系统用户信息（`systemVar.user.username`）
- 下游影响：无，工具返回下载链接后由调用方自行处理

## 功能边界
- 本模块负责：从 WPS 分享链接中提取文件信息、完成三层认证、获取可用下载 URL
- 本模块不负责：文件的实际下载（由调用方处理）、分享链接的生成、用户权限管理

## 注意事项
- 分享链接必须包含 `weboffice.cib.com.cn/weboffice/l/` 关键字，否则无法提取 shareFileId
- SM2 加密服务为内网地址，需确保网络可达
- KSO-1 签名中的时间使用 RFC2822 格式，注意时区一致性
- 用户标识 `notes_id` 从运行时系统变量 `systemVar.user.username` 获取

## 错误信息一览
| 错误信息 | 触发条件 |
|---------|---------|
| 输入的文件分享链接有误，未包含关键字 | 输入文本不含 WPS 分享链接特征 |
| 输入的文件分享链接有误，无法提取 shareFileId | 正则匹配失败 |
| SM2 加密接口未返回 ciphertext | 接口 1 返回异常 |
| getUserInfoForAIOp 接口未返回 data.token.access_token | 接口 2 返回异常 |
| 获取分享文件详情失败，未返回 drive_id 或 file_id | 接口 3 返回异常 |
| 获取下载链接失败，报错信息为：{msg} | 接口 4 返回失败 |

## 变更历史
- 2026-04-07: 创建接口文档
