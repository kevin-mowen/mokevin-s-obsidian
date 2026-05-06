# WPS 云文档分享链接导入 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 PandaWiki Admin 的文档导入菜单中新增"通过云文档分享链接导入"功能，支持用户粘贴 WPS 分享链接，后端自动解析为下载 URL 并通过 doc2md 转换为 Markdown 导入。

**Architecture:** 新增 `CrawlerSourceWpsShare` 类型贯穿前后端。后端新增 `pkg/wps` 包封装 WPS API 链路（SM2 加密 → 获取 token → 获取文件详情 → 获取下载 URL）。前端参考 URL 导入的表单和提交逻辑，新增独立分支。ParseUrl 阶段先调用 WPS 链路获取下载 URL，再复用现有 `GetUrlList` + `doc2md` 流程。

**Tech Stack:** Go (后端)、React + TypeScript + MUI (前端)、HMAC-SHA256 签名、HTTP API 调用

---

## 文件结构

### 新增文件
| 文件 | 职责 |
|------|------|
| `backend/pkg/wps/client.go` | WPS API 客户端：SM2 加密、获取 token、获取文件详情、获取下载 URL |
| `backend/pkg/wps/types.go` | WPS 请求/响应类型定义 |

### 修改文件
| 文件 | 修改内容 |
|------|----------|
| `backend/consts/parse.go` | 新增 `CrawlerSourceWpsShare` 枚举和 Type() 分支 |
| `backend/config/config.go` | 新增 `WpsConfig` 配置结构体 |
| `backend/config/config.local.yml` | 新增 WPS 本地配置 |
| `backend/usecase/crawler.go` | NewCrawlerUsecase 注入 AuthRepo + WPS Client；ParseUrl/ExportDoc 新增分支 |
| `backend/handler/v1/crawler.go` | CrawlerParse 新增 WpsShare 参数校验 |
| `backend/api/crawler/v1/crawler.go` | CrawlerParseReq 无需改（Key 字段已够用） |
| `web/admin/src/request/types.ts` | ConstsCrawlerSource 新增枚举值 |
| `web/admin/src/pages/document/component/AddDocBtn.tsx` | 菜单新增"通过云文档分享链接导入" |
| `web/admin/src/pages/document/component/AddDocByType/constants.ts` | TYPE_CONFIG 新增配置 |
| `web/admin/src/pages/document/component/AddDocByType/FormSubmit/FormInput.tsx` | formFieldsConfig 新增字段 |
| `web/admin/src/pages/document/component/AddDocByType/FormSubmit/index.tsx` | handleSubmitForm 新增 case |
| `web/admin/src/pages/document/component/AddDocByType/util.ts` | validateFormData 新增校验 |

---

## Task 1: 后端 — 新增 CrawlerSourceWpsShare 枚举

**Files:**
- Modify: `backend/consts/parse.go:5-43`

- [ ] **Step 1: 在 CrawlerSource 常量块新增 WpsShare**

在 `CrawlerSourceDingtalk` 之后新增：

```go
CrawlerSourceWpsShare CrawlerSource = "wps_share"
```

- [ ] **Step 2: 在 Type() 方法中将 WpsShare 归类为 CrawlerSourceTypeUrl**

修改 `func (c CrawlerSource) Type()` 的第一个 case：

```go
case consts.CrawlerSourceNotion, consts.CrawlerSourceFeishu, consts.CrawlerSourceDingtalk:
```

改为：

```go
case consts.CrawlerSourceNotion, consts.CrawlerSourceFeishu, consts.CrawlerSourceDingtalk, consts.CrawlerSourceWpsShare:
```

> WpsShare 归类为 `CrawlerSourceTypeKey`，因为前端传入的是分享链接而非直接 URL，不需要走文件上传流程。

- [ ] **Step 3: 验证编译**

```bash
cd /Users/mokevin/work/ai/pandawiki/backend && go build ./...
```

Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add backend/consts/parse.go
git commit -m "feat: 新增 CrawlerSourceWpsShare 枚举类型"
```

---

## Task 2: 后端 — 新增 WPS 配置

**Files:**
- Modify: `backend/config/config.go:30-33`
- Modify: `backend/config/config.local.yml`

- [ ] **Step 1: 在 Config 结构体新增 WPS 配置**

在 `config.go` 的 `Config` 结构体中，`FastGPT` 字段之后新增：

```go
Wps WpsConfig `mapstructure:"wps"`
```

在 `FastGPTConfig` 之后新增配置结构体：

```go
type WpsConfig struct {
	Enabled   bool   `mapstructure:"enabled"`
	AppID     string `mapstructure:"app_id"`
	AppKey    string `mapstructure:"app_key"`
	YundocURL string `mapstructure:"yundoc_url"`
	CipherURL string `mapstructure:"cipher_url"`
	PublicKey string `mapstructure:"public_key"`
}
```

- [ ] **Step 2: 在 config.local.yml 新增 WPS 本地配置**

```yaml
wps:
  enabled: true
  app_id: "VIGEKDPAZAWRRFXK"
  app_key: "SKmizelipfjracld"
  yundoc_url: "https://weboffice.cib.com.cn"
  cipher_url: "http://20.201.9.111:8180"
  public_key: "BL+htj+HB2hpBW8DBNKkMW7PenraiMTFM47OaFnWg6UbtcmUFnk7SWBB+JpUEhUSHZXDMOVlzBOG1MXi6Tc2iB0="
```

- [ ] **Step 3: 验证编译**

```bash
cd /Users/mokevin/work/ai/pandawiki/backend && go build ./...
```

- [ ] **Step 4: Commit**

```bash
git add backend/config/config.go backend/config/config.local.yml
git commit -m "feat: 新增 WPS 云文档配置项"
```

---

## Task 3: 后端 — 新增 WPS 客户端包

**Files:**
- Create: `backend/pkg/wps/types.go`
- Create: `backend/pkg/wps/client.go`

- [ ] **Step 1: 创建 types.go**

```go
package wps

// SM2EncryptRequest SM2 加密请求
type SM2EncryptRequest struct {
	Plaintext string `json:"plaintext"`
	PublicKey string `json:"publicKey"`
}

// SM2EncryptResponse SM2 加密响应
type SM2EncryptResponse struct {
	Ciphertext string `json:"ciphertext"`
}

// GetUserInfoRequest 获取 access_token 请求
type GetUserInfoRequest struct {
	Data string `json:"data"`
}

// GetUserInfoResponse 获取 access_token 响应
type GetUserInfoResponse struct {
	Data struct {
		Token struct {
			AccessToken string `json:"access_token"`
		} `json:"token"`
	} `json:"data"`
}

// FileMetaResponse 获取分享文件详情响应
type FileMetaResponse struct {
	Data struct {
		DriveID string `json:"drive_id"`
		FileID  string `json:"file_id"`
	} `json:"data"`
}

// DownloadResponse 获取下载链接响应
type DownloadResponse struct {
	Data struct {
		URL string `json:"url"`
	} `json:"data"`
	Msg string `json:"msg"`
}

// SM2PlainData SM2 加密明文数据
type SM2PlainData struct {
	Timestamp int64  `json:"timestamp"`
	NotesID   string `json:"notes_id"`
}
```

- [ ] **Step 2: 创建 client.go**

```go
package wps

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/chaitin/panda-wiki/config"
	"github.com/chaitin/panda-wiki/log"
)

var shareFileIDRegex = regexp.MustCompile(`weboffice\.cib\.com\.cn/weboffice/l/([^\s]+)`)

type Client struct {
	httpClient *http.Client
	logger     *log.Logger
	config     *config.WpsConfig
}

func NewClient(logger *log.Logger, cfg *config.WpsConfig) *Client {
	return &Client{
		logger: logger.WithModule("wps.client"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		config: cfg,
	}
}

func (c *Client) IsEnabled() bool {
	return c.config.Enabled
}

// GetDownloadURL 根据 WPS 分享链接获取下载 URL
// 完整 7 步链路：提取 shareFileId → KSO 签名 → SM2 加密 → 获取 token → 获取文件详情 → 下载签名 → 获取下载链接
func (c *Client) GetDownloadURL(ctx context.Context, shareLink string, notesID string) (string, error) {
	c.logger.Info("WPS GetDownloadURL start", "shareLink", shareLink, "notesID", notesID)

	// 步骤 1: 正则提取 shareFileId
	matches := shareFileIDRegex.FindStringSubmatch(shareLink)
	if len(matches) < 2 {
		return "", fmt.Errorf("无法从链接中提取分享文件ID: %s", shareLink)
	}
	shareFileID := matches[1]
	c.logger.Info("提取 shareFileId", "shareFileId", shareFileID)

	// 步骤 2-3: SM2 加密 + 获取 access_token
	accessToken, err := c.getAccessToken(ctx, notesID)
	if err != nil {
		return "", fmt.Errorf("获取 access_token 失败: %w", err)
	}

	// 步骤 4: 获取分享文件详情（drive_id, file_id）
	driveID, fileID, err := c.getFileMeta(ctx, shareFileID, accessToken)
	if err != nil {
		return "", fmt.Errorf("获取分享文件详情失败: %w", err)
	}

	// 步骤 5-6: 获取下载链接
	downloadURL, err := c.getDownloadURL(ctx, driveID, fileID, accessToken)
	if err != nil {
		return "", fmt.Errorf("获取下载链接失败: %w", err)
	}

	c.logger.Info("WPS GetDownloadURL success", "shareLink", shareLink)
	return downloadURL, nil
}

// getAccessToken SM2 加密 notesID 后换取 access_token
func (c *Client) getAccessToken(ctx context.Context, notesID string) (string, error) {
	// 构造明文 JSON
	plainData := SM2PlainData{
		Timestamp: time.Now().UnixMilli(),
		NotesID:   notesID,
	}
	plainJSON, _ := json.Marshal(plainData)
	plainBase64 := base64.StdEncoding.EncodeToString(plainJSON)

	// 调用 SM2 加密服务
	encryptReq := SM2EncryptRequest{
		Plaintext: plainBase64,
		PublicKey: c.config.PublicKey,
	}
	encryptBody, _ := json.Marshal(encryptReq)

	encryptURL := fmt.Sprintf("%s/api/sm2/encrypt", strings.TrimRight(c.config.CipherURL, "/"))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, encryptURL, bytes.NewBuffer(encryptBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("SM2 加密服务请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var encryptResp SM2EncryptResponse
	if err := json.Unmarshal(body, &encryptResp); err != nil {
		return "", fmt.Errorf("SM2 加密响应解析失败: %w", err)
	}
	if encryptResp.Ciphertext == "" {
		return "", fmt.Errorf("SM2 加密未返回密文, 响应: %s", string(body))
	}

	// 用密文换取 access_token
	userInfoReq := GetUserInfoRequest{Data: encryptResp.Ciphertext}
	userInfoBody, _ := json.Marshal(userInfoReq)

	tokenURL := fmt.Sprintf("%s/c/ciblogin/api/v1/getUserInfoForAIOp", strings.TrimRight(c.config.YundocURL, "/"))
	req2, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, bytes.NewBuffer(userInfoBody))
	if err != nil {
		return "", err
	}
	req2.Header.Set("Content-Type", "application/json")

	resp2, err := c.httpClient.Do(req2)
	if err != nil {
		return "", fmt.Errorf("获取 access_token 请求失败: %w", err)
	}
	defer resp2.Body.Close()

	body2, _ := io.ReadAll(resp2.Body)
	var userInfoResp GetUserInfoResponse
	if err := json.Unmarshal(body2, &userInfoResp); err != nil {
		return "", fmt.Errorf("access_token 响应解析失败: %w", err)
	}
	if userInfoResp.Data.Token.AccessToken == "" {
		return "", fmt.Errorf("获取 access_token 失败, 响应: %s", string(body2))
	}

	return userInfoResp.Data.Token.AccessToken, nil
}

// getFileMeta 获取分享文件的 drive_id 和 file_id
func (c *Client) getFileMeta(ctx context.Context, shareFileID, accessToken string) (string, string, error) {
	uri := fmt.Sprintf("/v7/links/%s/meta", shareFileID)
	metaURL := fmt.Sprintf("%s/openapi%s", strings.TrimRight(c.config.YundocURL, "/"), uri)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, metaURL, nil)
	if err != nil {
		return "", "", err
	}

	c.setKSOHeaders(req, "GET", uri, "", accessToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var metaResp FileMetaResponse
	if err := json.Unmarshal(body, &metaResp); err != nil {
		return "", "", fmt.Errorf("文件详情响应解析失败: %w", err)
	}
	if metaResp.Data.DriveID == "" || metaResp.Data.FileID == "" {
		return "", "", fmt.Errorf("获取文件详情失败, 响应: %s", string(body))
	}

	return metaResp.Data.DriveID, metaResp.Data.FileID, nil
}

// getDownloadURL 获取文件下载链接
func (c *Client) getDownloadURL(ctx context.Context, driveID, fileID, accessToken string) (string, error) {
	uri := fmt.Sprintf("/v7/drives/%s/files/%s/download?with_hash=true", driveID, fileID)
	downloadURL := fmt.Sprintf("%s/openapi%s", strings.TrimRight(c.config.YundocURL, "/"), uri)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return "", err
	}

	c.setKSOHeaders(req, "GET", uri, "", accessToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var dlResp DownloadResponse
	if err := json.Unmarshal(body, &dlResp); err != nil {
		return "", fmt.Errorf("下载链接响应解析失败: %w", err)
	}
	if dlResp.Msg != "" {
		return "", fmt.Errorf("获取下载链接失败: %s", dlResp.Msg)
	}
	if dlResp.Data.URL == "" {
		return "", fmt.Errorf("获取下载链接失败, 响应: %s", string(body))
	}

	return dlResp.Data.URL, nil
}

// setKSOHeaders 设置 KSO-1 签名头
func (c *Client) setKSOHeaders(req *http.Request, method, uri, contentType, accessToken string) {
	ksoDate := time.Now().UTC().Format(time.RFC1123)

	// 签名原文: "KSO-1" + method + uri + contentType + ksoDate + sha256Hex(body)
	// 对于 GET 请求 body 为空，sha256Hex 为空字符串
	message := "KSO-1" + method + uri + contentType + ksoDate

	mac := hmac.New(sha256.New, []byte(c.config.AppKey))
	mac.Write([]byte(message))
	signature := hex.EncodeToString(mac.Sum(nil))

	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-Kso-Date", ksoDate)
	req.Header.Set("X-Kso-Authorization", fmt.Sprintf("KSO-1 %s:%s", c.config.AppID, signature))
	req.Header.Set("Authorization", "Bearer "+accessToken)
}

// ksoSignature 计算 KSO-1 HMAC-SHA256 签名
func ksoSignature(secretKey, method, uri, contentType, ksoDate, requestBody string) string {
	sha256Hex := ""
	if requestBody != "" {
		hash := sha256.Sum256([]byte(requestBody))
		sha256Hex = hex.EncodeToString(hash[:])
	}

	message := "KSO-1" + method + uri + contentType + ksoDate + sha256Hex
	mac := hmac.New(sha256.New, []byte(secretKey))
	mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))
}
```

- [ ] **Step 3: 验证编译**

```bash
cd /Users/mokevin/work/ai/pandawiki/backend && go build ./...
```

- [ ] **Step 4: Commit**

```bash
git add backend/pkg/wps/
git commit -m "feat: 新增 WPS 云文档 API 客户端（SM2 加密 + KSO 签名 + 下载链路）"
```

---

## Task 4: 后端 — CrawlerUsecase 集成 WPS 和 AuthRepo

**Files:**
- Modify: `backend/usecase/crawler.go:33-64` (结构体和构造函数)
- Modify: `backend/usecase/crawler.go:97-318` (ParseUrl 方法)
- Modify: `backend/usecase/crawler.go:320-430` (ExportDoc 方法)
- Modify: `backend/handler/v1/crawler.go:23-44` (注入 + 校验)

- [ ] **Step 1: CrawlerUsecase 结构体新增依赖**

在 `CrawlerUsecase` 结构体中新增：

```go
wpsClient *wps.Client
authRepo  *pg.AuthRepo
```

在 `NewCrawlerUsecase` 函数签名新增参数 `authRepo *pg.AuthRepo`，函数体中新增：

```go
var wpsClient *wps.Client
if config.Wps.Enabled {
	wpsClient = wps.NewClient(logger, &config.Wps)
}
```

返回值中加入 `wpsClient: wpsClient, authRepo: authRepo`。

- [ ] **Step 2: ParseUrl 新增 CrawlerSourceWpsShare 分支**

在 `ParseUrl` 方法的 `switch req.CrawlerSource` 中，`case consts.CrawlerSourceUrl, consts.CrawlerSourceFile:` 之前新增：

```go
case consts.CrawlerSourceWpsShare:
	if u.wpsClient == nil || !u.wpsClient.IsEnabled() {
		return nil, fmt.Errorf("WPS 云文档导入功能未启用")
	}
	// 从上下文获取当前用户的 notesID
	authInfo := domain.GetAuthInfoFromCtx(ctx)
	if authInfo == nil || authInfo.AuthID == 0 {
		return nil, fmt.Errorf("当前账号不支持云文档导入，请使用关联用户账号登录")
	}
	authMap, err := u.authRepo.GetAuthUserinfoByIDs(ctx, []uint{authInfo.AuthID})
	if err != nil || authMap[authInfo.AuthID] == nil {
		return nil, fmt.Errorf("获取用户认证信息失败")
	}
	notesID := authMap[authInfo.AuthID].AuthUserInfo.Username
	if notesID == "" {
		return nil, fmt.Errorf("当前账号缺少 username 信息，无法使用云文档导入")
	}

	// 调用 WPS API 获取下载 URL
	shareLink := req.Key
	downloadURL, err := u.wpsClient.GetDownloadURL(ctx, shareLink, notesID)
	if err != nil {
		u.logger.Error("WPS 获取下载链接失败", "shareLink", shareLink, log.Error(err))
		return nil, fmt.Errorf("云文档导入失败: %w", err)
	}
	u.logger.Info("WPS 下载链接获取成功", "shareLink", shareLink, "downloadURL", downloadURL)

	// 复用 URL 导入的逻辑
	resp, err := u.anydocClient.GetUrlList(ctx, downloadURL, id)
	if err != nil {
		return nil, err
	}
	for _, doc := range resp.Docs {
		docs.Children = append(docs.Children, anydoc.Child{
			Value: anydoc.Value{
				ID:       doc.Id,
				Title:    doc.Title,
				Summary:  doc.Summary,
				FileType: doc.FileType,
				File:     true,
			},
		})
	}
	// 缓存下载 URL 供 ExportDoc 使用 doc2md 转换
	if u.doc2mdClient.IsEnabled() {
		cacheKey := fmt.Sprintf("doc2md:fileurl:%s", id)
		u.cache.Set(ctx, cacheKey, downloadURL, 2*time.Hour)
	}
```

- [ ] **Step 3: ExportDoc 新增 CrawlerSourceWpsShare 分支**

在 `ExportDoc` 方法中，将 `case consts.CrawlerSourceUrl, consts.CrawlerSourceFile:` 改为：

```go
case consts.CrawlerSourceUrl, consts.CrawlerSourceFile, consts.CrawlerSourceWpsShare:
```

这样 WpsShare 在 export 阶段直接复用 URL/File 的 doc2md 逻辑。

- [ ] **Step 4: Handler 层新增校验**

在 `CrawlerParse` handler 的 `switch req.CrawlerSource` 中新增：

```go
case consts.CrawlerSourceWpsShare:
	if req.Key == "" {
		return h.NewResponseWithError(c, "请输入云文档分享链接", nil)
	}
```

- [ ] **Step 5: 更新 Wire 注入（如需要）**

检查 `NewCrawlerUsecase` 是否通过 Wire 注入。如果是，运行：

```bash
cd /Users/mokevin/work/ai/pandawiki && bash scripts/wire-auto-register.sh
```

- [ ] **Step 6: 验证编译**

```bash
cd /Users/mokevin/work/ai/pandawiki/backend && go build ./...
```

- [ ] **Step 7: Commit**

```bash
git add backend/usecase/crawler.go backend/handler/v1/crawler.go
git commit -m "feat: CrawlerUsecase 集成 WPS 云文档导入链路"
```

---

## Task 5: 前端 — 新增 ConstsCrawlerSource 枚举值

**Files:**
- Modify: `web/admin/src/request/types.ts:209-223`

- [ ] **Step 1: 在 ConstsCrawlerSource 枚举末尾新增**

在 `CrawlerSourceConfluence = "confluence"` 之后新增：

```typescript
CrawlerSourceWpsShare = "wps_share",
```

- [ ] **Step 2: Commit**

```bash
git add web/admin/src/request/types.ts
git commit -m "feat: 前端新增 CrawlerSourceWpsShare 枚举值"
```

---

## Task 6: 前端 — 导入菜单新增入口

**Files:**
- Modify: `web/admin/src/pages/document/component/AddDocBtn.tsx:158-167`

- [ ] **Step 1: 在钉钉文档导入和 Confluence 导入之间新增菜单项**

在 `CrawlerSourceDingtalk` 菜单项之后、`CrawlerSourceConfluence` 菜单项之前新增：

```typescript
{
  key: ConstsCrawlerSource.CrawlerSourceWpsShare,
  label: '通过云文档分享链接导入',
  onClick: () => {
    setUploadOpen(true);
    setKey(ConstsCrawlerSource.CrawlerSourceWpsShare);
  },
},
```

- [ ] **Step 2: Commit**

```bash
git add web/admin/src/pages/document/component/AddDocBtn.tsx
git commit -m "feat: 导入菜单新增云文档分享链接导入选项"
```

---

## Task 7: 前端 — 类型配置和表单

**Files:**
- Modify: `web/admin/src/pages/document/component/AddDocByType/constants.ts:57-141`
- Modify: `web/admin/src/pages/document/component/AddDocByType/FormSubmit/FormInput.tsx:59-126`
- Modify: `web/admin/src/pages/document/component/AddDocByType/util.ts:22-63`

- [ ] **Step 1: constants.ts 新增 TYPE_CONFIG**

在 `TYPE_CONFIG` 中 `CrawlerSourceConfluence` 配置之后新增：

```typescript
[ConstsCrawlerSource.CrawlerSourceWpsShare]: {
  label: '通过云文档分享链接导入',
  okText: '拉取数据',
},
```

- [ ] **Step 2: FormInput.tsx 新增表单字段配置**

在 `formFieldsConfig` 中新增：

```typescript
[ConstsCrawlerSource.CrawlerSourceWpsShare]: [
  {
    label: '云文档分享链接',
    placeholder: '每行一个分享链接\n例如: https://weboffice.cib.com.cn/weboffice/l/xxxxx',
    fieldName: 'url',
    multiline: true,
    rows: 20,
  },
],
```

- [ ] **Step 3: util.ts 的 validateFormData 新增校验**

将 `validateFormData` 中的 URL 校验条件扩展，在 `includes` 数组中新增 `ConstsCrawlerSource.CrawlerSourceWpsShare`：

```typescript
if (
  [
    ConstsCrawlerSource.CrawlerSourceUrl,
    ConstsCrawlerSource.CrawlerSourceRSS,
    ConstsCrawlerSource.CrawlerSourceSitemap,
    ConstsCrawlerSource.CrawlerSourceNotion,
    ConstsCrawlerSource.CrawlerSourceWpsShare,
  ].includes(type)
) {
```

- [ ] **Step 4: Commit**

```bash
git add web/admin/src/pages/document/component/AddDocByType/
git commit -m "feat: 前端云文档导入表单配置和校验"
```

---

## Task 8: 前端 — 提交逻辑

**Files:**
- Modify: `web/admin/src/pages/document/component/AddDocByType/FormSubmit/index.tsx:51-118`

- [ ] **Step 1: handleSubmitForm 新增 CrawlerSourceWpsShare case**

在 `switch (type)` 中，`case ConstsCrawlerSource.CrawlerSourceUrl:` 之后新增（逻辑几乎一致，仅 `crawler_source` 不同）：

```typescript
case ConstsCrawlerSource.CrawlerSourceWpsShare: {
  const urls = formData.url?.split('\n').filter(u => u.trim()) || [];

  const urlToUuidMap = new Map<string, string>();
  const newItems: ListDataItem[] = urls.map(url => {
    const uuid = uuidv4();
    urlToUuidMap.set(url, uuid);
    return {
      uuid,
      task_id: '',
      parent_id: parent_id || '',
      platform_id: '',
      id: url,
      title: url,
      summary: '',
      status: 'parsing',
      file: true,
      open: false,
    } as ListDataItem;
  });

  setData(prev => [...prev, ...newItems]);

  await Promise.all(
    urls.map(url =>
      queue.enqueue(async () => {
        const itemUuid = urlToUuidMap.get(url)!;
        try {
          const resp = await postApiV1CrawlerParse({
            crawler_source: type,
            key: url,
            kb_id,
          });
          setData(prev =>
            prev.map(item =>
              item.uuid === itemUuid
                ? {
                    ...item,
                    platform_id: resp.id!,
                    id: resp.docs?.value?.id || '',
                    title: resp.docs?.value?.title || url,
                    summary: resp.docs?.value?.summary || '',
                    status: 'parsed',
                  }
                : item,
            ),
          );
        } catch (error) {
          setData(prev =>
            prev.map(item =>
              item.uuid === itemUuid
                ? {
                    ...item,
                    status: 'parse-error',
                    summary:
                      error instanceof Error
                        ? error.message
                        : '操作失败，请稍后重试',
                  }
                : item,
            ),
          );
        }
      }),
    ),
  );
  break;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/admin/src/pages/document/component/AddDocByType/FormSubmit/index.tsx
git commit -m "feat: 前端云文档分享链接导入提交逻辑"
```

---

## Task 9: 集成验证

- [ ] **Step 1: 后端编译验证**

```bash
cd /Users/mokevin/work/ai/pandawiki/backend && go build ./...
```

- [ ] **Step 2: 前端编译验证**

```bash
cd /Users/mokevin/work/ai/pandawiki/web && pnpm build
```

- [ ] **Step 3: 启动开发环境**

```bash
cd /Users/mokevin/work/ai/pandawiki && bash scripts/dev-start.sh
```

- [ ] **Step 4: 功能验证清单**

1. 打开 http://dev.localhost:2443 管理后台
2. 进入文档页面，点击"创建文档"菜单
3. 确认菜单中出现"通过云文档分享链接导入"选项
4. 点击后确认弹窗样式正确（多行文本框，"拉取数据"按钮）
5. 用管理员账号测试 → 应返回错误提示"当前账号不支持云文档导入"
6. 用关联用户账号登录测试 → 粘贴有效分享链接 → 确认解析成功
7. 测试多个链接（每行一个）→ 确认逐个解析
8. 测试无效链接 → 确认返回明确错误信息

---

## 注意事项

1. **权限检查**：只有通过外部认证（CAS 等）登录且拥有 `username` 的用户才能使用此功能。管理员本地账号登录时，`AuthID == 0`，会返回明确错误。
2. **下载链接有效期**：WPS 下载链接可能很快过期，ParseUrl 阶段获取后会缓存。ExportDoc 阶段 doc2md 读取缓存的下载 URL 进行转换，需尽快完成。
3. **SM2 服务不可用**：如果 `http://20.201.9.111:8180` 不可达，错误信息会包含具体失败原因，后端日志会打印分享链接参数。
4. **Wire 注入**：`NewCrawlerUsecase` 新增 `authRepo` 参数后，需要确保 Wire 依赖正确注入，可能需要运行 `wire-auto-register.sh`。
