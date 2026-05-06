# WPS 分享链接转下载链接

## 功能描述

从用户输入中提取 WPS 分享链接，经过身份认证和文件信息查询，最终返回可直接下载的文件 URL。入口为 FastGPT 插件工具 `wpsInteract/wpsGetDownloadUrlByShareFile`。

## 功能特性

- 自动从文本中提取 WPS 分享链接
- 使用 SM2 加密进行用户身份认证
- KSO-1 签名鉴权访问 WPS OpenAPI
- 支持通过 notesId（从系统变量自动获取）完成用户认证
- 全链路日志记录，便于排查

## 实现文件

- `modules/tool/packages/wpsInteract/config.ts` - 工具集配置（名称、描述、标签）
- `modules/tool/packages/wpsInteract/index.ts` - 工具集导出入口
- `modules/tool/packages/wpsInteract/children/wpsGetDownloadUrlByShareFile/config.ts` - 子工具配置（输入输出定义）
- `modules/tool/packages/wpsInteract/children/wpsGetDownloadUrlByShareFile/index.ts` - 子工具导出入口
- `modules/tool/packages/wpsInteract/children/wpsGetDownloadUrlByShareFile/src/index.ts` - **核心业务逻辑**（约 330 行）
- `modules/tool/packages/wpsInteract/children/wpsGetDownloadUrlByShareFile/test/index.test.ts` - 单元测试

## 数据结构

### 输入参数 (InputType)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| userInput | string | 是 | 包含 WPS 分享链接的用户输入文本，最少 1 个字符 |

### 输出参数 (OutputType)

| 字段 | 类型 | 说明 |
|------|------|------|
| result | string | 成功时返回下载 URL；失败时返回错误描述 |

### 系统变量依赖

| 字段路径 | 用途 |
|---------|------|
| systemVar.user.username | 作为 notesId 用于 WPS 用户认证 |

## 固定配置（硬编码）

| 配置项 | 值 | 说明 |
|--------|-----|------|
| APP_ID | `VIGEKDPAZAWRRFXK` | WPS OpenAPI 应用 ID |
| APP_KEY | `SKmizelipfjracld` | WPS OpenAPI 应用密钥，用于 KSO-1 签名 |
| YUNDOC_URL | `https://weboffice.cib.com.cn` | WPS 云文档服务地址 |
| CIPHER_URL | `http://20.201.9.111:8180` | SM2 加密服务地址（内网） |
| PUBLIC_KEY_STEP_1 | `BL+htj+HB2hpBW8...` | SM2 加密公钥 |

## 调用时序

```
用户输入（含WPS分享链接）
  │
  ▼ [本地] 正则提取 shareFileId
  │
  ▼ [本地] 计算 KSO-1 签名（HMAC-SHA256）
  │
  ▼ [接口1] POST SM2加密服务 ──→ ciphertext
  │
  ▼ [接口2] POST getUserInfoForAIOp(ciphertext) ──→ access_token
  │
  ▼ [接口3] GET /v7/links/{shareFileId}/meta ──→ drive_id, file_id
  │          （需要 KSO签名 + access_token）
  │
  ▼ [本地] 重新计算下载接口的 KSO-1 签名
  │
  ▼ [接口4] GET /v7/drives/{driveId}/files/{fileId}/download ──→ 下载URL
  │          （需要 新KSO签名 + access_token）
  │
  ▼ 返回下载URL
```

> 4 个接口**严格串行**，每一步输出是下一步输入。接口 3 和 4 共用接口 2 获取的 access_token，但 KSO 签名各自独立计算。

## 接口清单

| 序号 | 方法 | 地址 | 说明 | 详细文档 |
|------|------|------|------|---------|
| 1 | POST | `http://20.201.9.111:8180/api/sm2/encrypt` | SM2 加密 | [[接口1-SM2加密]] |
| 2 | POST | `https://weboffice.cib.com.cn/c/ciblogin/api/v1/getUserInfoForAIOp` | 获取 access_token | [[接口2-获取AccessToken]] |
| 3 | GET | `https://weboffice.cib.com.cn/openapi/v7/links/{shareFileId}/meta` | 获取分享文件详情 | [[接口3-获取分享文件详情]] |
| 4 | GET | `https://weboffice.cib.com.cn/openapi/v7/drives/{driveId}/files/{fileId}/download` | 获取下载链接 | [[接口4-获取下载链接]] |

## KSO-1 签名算法

接口 3 和接口 4 使用相同的签名算法，仅 URI 不同。

1. 如果有请求体，计算请求体的 SHA256 hex；否则为空字符串
2. 拼接签名原文：`"KSO-1" + HTTP方法 + URI路径 + Content-Type + RFC2822时间 + SHA256Hex`
3. 使用 APP_KEY 对签名原文做 HMAC-SHA256，输出 hex
4. 最终 Authorization 值：`KSO-1 {APP_ID}:{签名hex}`

RFC2822 时间格式示例：`Sat, 12 Apr 2026 12:00:00 GMT`

## 服务调用链路（插件框架层）

```
FastGPT 主系统
  │
  ▼ HTTP POST /tool/runstream
插件服务 Express (lib/router/index.ts)
  │
  ├── authTokenMiddleware 鉴权
  │
  ▼ runToolStreamHandler (modules/tool/api/runStream.ts)
  │
  ├── getTool(toolId) → 从缓存 toolMap 查找
  │
  ▼ tool.cb(inputs, {systemVar, streamResponse})
  │
  ├── exportTool 包装层 → Zod 校验 Input/Output
  │
  ▼ tool() 核心函数 → 7步流程
```

## 依赖关系

- 上游依赖：FastGPT 插件框架（工具加载、鉴权、流式响应）、SM2 加密服务（内网）、WPS 云文档 OpenAPI
- 下游影响：无，该工具为终端工具，输出直接返回给用户

## 功能边界

- 本模块负责：从分享链接提取文件ID、用户认证、获取下载URL
- 本模块不负责：文件的实际下载（由调用方处理）、access_token 缓存（每次重新获取）、分享链接的权限校验（由 WPS 侧控制）

## 注意事项

- APP_ID / APP_KEY / SM2 公钥均为硬编码，迁移时需同步
- SM2 加密服务为内网地址 `20.201.9.111:8180`，需确保网络可达
- WPS 云文档地址为行内定制域名 `weboffice.cib.com.cn`，非公网 WPS
- notesId 从 `systemVar.user.username` 获取，迁移后需确认身份信息来源
- HTTP 请求混用了封装的 `POST`（接口 1、2）和原生 `fetch`（接口 3、4），迁移时可统一

## 变更历史

- 2026-04-12: 整理完整服务调用链路文档
