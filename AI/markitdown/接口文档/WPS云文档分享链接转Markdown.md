---
tags:
  - markitdown
  - API
  - WPS
  - 接口文档
service: markitdown-api
endpoint: /wps/share_to_md
method: POST
version: 0.3.9
created: '2026-04-28'
---
# WPS 云文档分享链接转 Markdown

> markitdown-api 提供的端到端接口：传入 WPS 分享链接 → 自动鉴权下载 → 路由到对应转换器 → 返回 Markdown + 内嵌图片。

## 概述

将 WPS 云文档分享链接（`https://weboffice.cib.com.cn/weboffice/l/...`）一键转为 Markdown。

**链路**：

```
分享链接
  └─ 正则提取 shareFileId
  └─ SM2 加密 notes_id（调外部 SM2 服务）
  └─ 换取 access_token
  └─ KSO-1 签名拉取文件 meta（drive_id / file_id）
  └─ 换取临时下载 URL（15 分钟有效）
  └─ httpx 下载文件
  └─ 按扩展名路由到对应转换器
  └─ 返回 markdown + 图片字典
```

---

## 端点

```
POST /wps/share_to_md
Content-Type: application/json
```

服务默认监听端口 **8490**。

---

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `share_link` | string | 是 | WPS 分享链接，需匹配 `weboffice\.cib\.com\.cn/weboffice/l/([^\s]+)` |
| `notes_id` | string | 是 | 调用方用户工号，用于 SM2 加密换取 access_token |

**示例**：

```json
{
  "share_link": "https://weboffice.cib.com.cn/weboffice/l/cnTRGiWfp",
  "notes_id": "015032"
}
```

---

## 响应

### 成功 `200 OK`

```json
{
  "markdown": "# 标题\n\n正文...",
  "length": 12345,
  "download_url": "https://weboffice.cib.com.cn/minio/...",
  "filename": "集团微聊对外能力开放接口文档v2.4.1.doc",
  "converter": "libreoffice+mammoth",
  "images": {
    "image1.png": {
      "data": "iVBORw0KGgoAAAANS...",
      "content_type": "image/png",
      "filename": "image1.png"
    }
  }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `markdown` | string | 转换后的 Markdown 内容 |
| `length` | int | Markdown 字符数 |
| `download_url` | string | WPS 返回的临时下载 URL（**15 分钟有效**），可用于审计或兜底 |
| `filename` | string | 原始文件名（含扩展名） |
| `converter` | string | 实际使用的转换器名称（见下方对照表） |
| `images` | object \| 缺省 | base64 编码的内嵌图片字典；无内嵌图片时此字段缺省 |

#### `images` 子字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `data` | string | 图片二进制的 base64（不含 `data:image/...;base64,` 前缀） |
| `content_type` | string | MIME 类型，如 `image/png` / `image/jpeg` |
| `filename` | string | 图片文件名 |

**重要**：`images` 的 **key** 才是 markdown 中实际引用的字符串路径（如 `image1.png` 或 `images/abc.jpg`）。调用方需先把 base64 上传到自己的 OSS，再替换 markdown 中的引用——替换时**只能匹配 `](key)` 这种 src 位置**，不能用全局 `strings.ReplaceAll`，否则 alt 文本里的同名字符串会被一起替换成 URL。

#### `converter` 取值对照

按文件扩展名路由：

| 扩展名 | converter | 说明 |
|---|---|---|
| `.docx` | `mammoth` | mammoth 直转，保留标题层级、表格、图片 |
| `.doc` | `libreoffice+mammoth` | LibreOffice 转 docx 后再走 mammoth |
| `.html` / `.htm` | `markdownify` | 直接 markdownify 转换 |
| `.pptx` | `markitdown+pptx` | MarkItDown + python-pptx 提取图片 |
| `.xlsx` | `openpyxl` | openpyxl 处理，正确处理换行与合并单元格 |
| `.xls` | `libreoffice+openpyxl` | LibreOffice 转 xlsx 后走 openpyxl |
| `.pdf` | `mineru` 或 `markitdown` | 优先 MinerU OCR；MinerU 未配置或失败时回退 MarkItDown |
| 其他（`.csv`、`.jpg`、`.txt` 等） | `markitdown` | MarkItDown 兜底 |

---

### 错误响应

| HTTP | `error` 含义 | 触发场景 |
|---|---|---|
| `400` | `File type not allowed` | 文件扩展名命中黑名单（`.exe`、`.msi`、`.sh`、`.dll` 等 70+ 种）|
| `400` | `Could not retrieve file: <详情>` | 下载 download_url 时 httpx 网络异常 |
| `502` | `Upstream server returned an error: <详情>` | WPS 接口或下载 URL 返回非 2xx |
| `503` | `WPS 配置不完整，请检查 WPS_* 环境变量` | 服务端缺 `WPS_APP_ID` 等环境变量 |
| `500` | `<其他错误描述>` | 链路其他异常（分享链接正则匹配失败、SM2 加密失败、KSO 签名失败、转换器异常等）|

错误响应结构：

```json
{
  "error": "WPS 配置不完整，请检查 WPS_* 环境变量"
}
```

---

## 服务端配置

### WPS 鉴权环境变量（必填）

| 变量 | 说明 |
|---|---|
| `WPS_ENABLED` | 必须为 `true`，否则接口返回 503 |
| `WPS_APP_ID` | WPS 开放平台 app_id |
| `WPS_APP_KEY` | WPS 开放平台 app_key（用于 KSO-1 签名 HMAC-SHA256） |
| `WPS_YUNDOC_URL` | WPS 云文档 OpenAPI 基址，如 `https://weboffice.cib.com.cn` |
| `WPS_CIPHER_URL` | SM2 加密服务基址（提供 `/api/sm2/encrypt`） |
| `WPS_PUBLIC_KEY` | SM2 公钥，用于加密 notes_id 明文 |

### 可选环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `WPS_HTTP_TIMEOUT` | `30` | 单次 HTTP 请求超时（秒）|
| `MAMMOTH_LOOSE_ESCAPE` | `true` | mammoth/markdownify 转换时关闭 `_` `*` 转义；`false` 恢复默认转义 |
| `TMP_DIR` | `/tmp` | 临时文件目录 |
| `MINER_U_BASE_URL` | （空） | MinerU 服务地址，未配置则 PDF 走 MarkItDown |
| `MINER_U_TOKEN` | （空） | MinerU 认证 token |
| `MINER_U_PARSE_METHOD` | `ocr` | MinerU 解析方式（`ocr` / `auto` / `txt`） |

---

## 调用示例

### curl

```bash
curl -X POST http://markitdown-api:8490/wps/share_to_md \
  -H 'Content-Type: application/json' \
  -d '{
    "share_link": "https://weboffice.cib.com.cn/weboffice/l/cnTRGiWfp",
    "notes_id": "015032"
  }'
```

### Python

```python
import httpx

resp = httpx.post(
    "http://markitdown-api:8490/wps/share_to_md",
    json={
        "share_link": "https://weboffice.cib.com.cn/weboffice/l/cnTRGiWfp",
        "notes_id": "015032",
    },
    timeout=180.0,
)
data = resp.json()
markdown = data["markdown"]
images = data.get("images", {})
```

### Go

```go
type WpsShareReq struct {
    ShareLink string `json:"share_link"`
    NotesID   string `json:"notes_id"`
}

type ImageData struct {
    Data        string `json:"data"`
    ContentType string `json:"content_type"`
    Filename    string `json:"filename"`
}

type WpsShareResp struct {
    Markdown    string                `json:"markdown"`
    Length      int                   `json:"length"`
    DownloadURL string                `json:"download_url"`
    Filename    string                `json:"filename"`
    Converter   string                `json:"converter"`
    Images      map[string]ImageData  `json:"images,omitempty"`
}
```

---

## 调用方注意事项

### 1. 接口耗时

完整链路 = SM2 加密 + WPS 鉴权 + 下载 + 转换。建议：

- 一般文档：客户端 timeout **120 秒**
- 大文件 PDF（走 MinerU OCR）：**180~300 秒**

### 2. 图片处理

- 返回的 `images` 是 base64 字典，调用方需自行上传到 OSS 并替换 markdown 中的引用
- **图片路径替换务必使用正则匹配 `](key)` 位置**，不要用全局字符串替换

错误示例（曾在 PandaWiki 端踩过坑）：

```go
// ❌ 错误：当 alt 文本恰好等于 key 时，alt 也会被替换成 URL
markdown = strings.ReplaceAll(markdown, key, url)
```

正确做法：

```go
// ✅ 只匹配图片语法的 src 位置
re := regexp.MustCompile(`(\]\()(?:\./)?` + regexp.QuoteMeta(key) + `(\))`)
markdown = re.ReplaceAllString(markdown, "${1}"+url+"${2}")
```

### 3. alt 文本约定

- mammoth 路径：没有原生 alt 的图片会被赋予 `图片1`、`图片2`... 这种中文 + 序号的 alt（避免 alt 与文件名冲突导致全局替换误伤）
- MinerU 路径：alt 由 MinerU 决定，通常为空

### 4. `.doc` 老格式损耗

老 `.doc` 经 LibreOffice 转 `.docx` 时存在已知损耗：

- **封面页文本框**会被扁平化，可能出现 `AcceptAllChangesShown` 等文本框标签文字进正文
- **TOC field** 项可能被合并成一行
- **修订标记**未接受时会出现额外文本

如对格式要求严格，建议要求用户提供 `.docx`，或在调用方做后处理。

### 5. 下载 URL 时效

`download_url` 由 WPS 签发，**15 分钟内有效**，过期需要重新调本接口。

### 6. 黑名单文件类型

以下扩展名直接拒绝（返回 400）：

`.exe` `.msi` `.bat` `.cmd` `.dmg` `.pkg` `.app` `.bin` `.sh` `.run` `.dll` `.so` `.dylib` `.jar` `.apk` `.vbs` `.ps1` `.pyc` `.pyo` `.sys` `.drv` `.dat` `.db` `.sqlite` `.mdb` `.dxf` `.dwg` `.stl` `.obj` `.3ds` `.blend` `.gpg` `.asc` `.pgp` `.vdi` `.vmdk` `.ova` `.docker` `.containerd` `.class` `.o` `.a` `.lib` `.ttf` `.otf` `.fon` 等。

完整列表见 `app.py` 中 `FORBIDDEN_EXTENSIONS`。

---

## 内部链路细节（运维参考）

### 鉴权流程

```
1. POST {WPS_CIPHER_URL}/api/sm2/encrypt
   body: {"plaintext": base64(json({"timestamp": ms, "notes_id": notes_id})), "publicKey": ...}
   resp: {"ciphertext": "..."}

2. POST {WPS_YUNDOC_URL}/c/ciblogin/api/v1/getUserInfoForAIOp
   body: {"data": ciphertext}
   resp: {"data": {"token": {"access_token": "..."}}}

3. GET {WPS_YUNDOC_URL}/openapi/v7/links/{shareFileId}/meta
   header: KSO-1 签名 + Bearer access_token
   resp: {"data": {"drive_id": "...", "file_id": "..."}}

4. GET {WPS_YUNDOC_URL}/openapi/v7/drives/{drive_id}/files/{file_id}/download?with_hash=true
   header: KSO-1 签名 + Bearer access_token
   resp: {"data": {"url": "https://.../?X-Amz-..."}}
```

### KSO-1 签名规则

```
message = "KSO-1" + method + uri + content_type + RFC1123_GMT_date
signature = HMAC-SHA256(app_key, message).hex()

请求头:
  X-Kso-Date: <RFC1123 GMT 时间>
  X-Kso-Authorization: KSO-1 {app_id}:{signature}
  Authorization: Bearer {access_token}
```

详细实现见 `wps_client.py` 的 `_kso_headers` 方法。

---

## 版本

| 版本 | 日期 | 说明 |
|---|---|---|
| `0.3.8` | 2026-04-24 | 接口首次引入（commit `88fadb9`） |
| `0.3.9` | 2026-04-28 | mammoth 路径增强：图片提出 strong/em、alt 改为"图片N"避开调用方全局替换；补充中文标题样式 `标题 1~5`；markdownify 关闭 `_`/`*` 转义可通过 `MAMMOTH_LOOSE_ESCAPE` 控制 |

---

## 相关资料

- 服务代码：`app.py` 中 `WpsShareItem` / `wps_share_to_md`（约 1492-1569 行）
- WPS 客户端实现：`wps_client.py`
- 路由分发：`app.py` 中 `route_convert` 函数
- 项目仓库：`/Users/mokevin/work/ai/markitdown-api`
