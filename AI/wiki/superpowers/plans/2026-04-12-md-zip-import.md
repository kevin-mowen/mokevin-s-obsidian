# Markdown 压缩包导入 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持用户上传包含 Markdown 文件和本地图片的 ZIP 压缩包，自动解析 MD 中的图片引用、上传图片到 MinIO、替换路径，并支持包内非 MD 文件走 markitdown-api 转换。

**Architecture:** 新增 `md_zip` CrawlerSource 类型。前端上传 ZIP 文件后，后端解压遍历：MD 文件直接读取内容并解析相对路径图片上传到 MinIO；非 MD 的 doc2md 支持格式文件走现有 markitdown-api 转换流程。每个文件产出一个 Markdown 文档，多个文件批量返回。

**Tech Stack:** Go (archive/zip, regexp), React/TypeScript, MinIO S3, Redis 缓存

---

## 文件清单

### 后端新增/修改

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/consts/parse.go` | 修改 | 新增 `CrawlerSourceMdZip` 常量，`Type()` 方法加分支 |
| `backend/usecase/crawler.go` | 修改 | 新增 `MdZipParse()` 和 `MdZipExport()` 方法，`ParseUrl`/`ExportDoc` 加 case 分支 |
| `backend/handler/v1/crawler.go` | 修改 | `CrawlerParse` handler 加 `md_zip` 的验证逻辑（仅需 Key） |
| `backend/api/crawler/v1/crawler.go` | 不改 | 现有 `CrawlerParseReq`/`CrawlerExportReq` 已满足需求 |

### 前端新增/修改

| 文件 | 操作 | 说明 |
|------|------|------|
| `web/admin/src/request/types.ts` | 修改 | `ConstsCrawlerSource` 枚举新增 `CrawlerSourceMdZip` |
| `web/app/src/request/types.ts` | 修改 | 同上 |
| `web/admin/src/pages/document/component/AddDocByType/constants.ts` | 修改 | 新增 `md_zip` 类型配置 |
| `web/admin/src/pages/document/component/AddDocBtn.tsx` | 修改 | 菜单新增 "通过 Markdown 压缩包导入" 选项 |

### Swagger 生成

前端 `request/types.ts` 中的 `ConstsCrawlerSource` 是由 Swagger 自动生成的（文件头标注 `THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API`）。**不能直接手动编辑**，需先更新后端 Swagger 注释再执行 `make generate` 重新生成。如果项目实际工作流是手动编辑后不再执行 generate，则可直接编辑（待确认）。

---

## 核心设计

### 后端处理流程

> **关键机制**：`ParseUrl()` 在进入 switch 之前，对 `CrawlerSourceTypeFile` 类型会自动将 `req.Key`（S3 对象 key）拼接为完整 HTTP URL：`http://{s3Endpoint}/static-file/{key}`（见 `crawler.go:105-107`）。因此 `mdZipParse` 收到的已经是可直接 HTTP GET 的 URL。

```
1. 前端上传 .zip → MinIO，得到 fileKey（S3 对象 key）
2. 前端调 ParseUrl(crawler_source=md_zip, key=fileKey)
   → ParseUrl 自动将 key 拼为完整 URL: http://{s3Endpoint}/static-file/{fileKey}
3. 后端 MdZipParse():
   a. 用 HTTP GET 下载 URL 指向的 ZIP 文件到内存
   b. 遍历 ZIP 内所有文件，构建文档树：
      - .md 文件 → 标记为 md 类型文档节点
      - .docx/.pdf/.pptx 等 doc2md 支持格式 → 标记为对应类型文档节点
      - 图片文件/其他 → 跳过（仅作为 MD 附属资源）
   c. 返回文档树（AnydocChild 格式）
   d. 将完整 URL 缓存到 Redis（供 Export 阶段使用），key: md_zip:filekey:{id}，TTL 2小时

4. 用户选择要导入的文档，调 ExportDoc(crawler_source=md_zip)
5. 后端 MdZipExport():
   a. 从 Redis 取回 URL（key: md_zip:filekey:{platformID}），HTTP GET 重新下载 ZIP
   b. 根据 DocID（即文件在 ZIP 中的路径）找到对应文件
   c. 如果是 .md 文件：
      - 读取 MD 内容
      - 用正则解析图片引用: ![alt](相对路径)
      - 在 ZIP 中按相对路径（相对于 MD 文件所在目录）查找图片
      - 将找到的图片上传 MinIO
      - 替换 MD 中的路径为 /static-file/{s3Key}
      - 缓存结果，返回 syntheticTaskId
   d. 如果是 doc2md 支持格式：
      - 将文件从 ZIP 中提取，上传到 MinIO 临时路径
      - 调用 doc2mdClient.ConvertToMarkdown(minioUrl)
      - 上传返回的 base64 图片（复用 uploadDoc2mdImages）
      - 缓存结果，返回 syntheticTaskId

6. 前端轮询 ScrapeGetResult → 从 Redis 缓存取回 Markdown（已有逻辑支持）
```

### 图片路径解析规则

MD 中的图片引用格式：
- `![alt](./images/foo.png)`
- `![alt](images/foo.png)`
- `![alt](../shared/bar.jpg)`
- `![alt](photo.png)` （同级目录）

解析逻辑：以 MD 文件在 ZIP 中的目录为基准，用 `path.Join(mdDir, imgRelPath)` 计算图片在 ZIP 中的完整路径，然后在 ZIP 文件列表中查找。

### ZIP 内容缓存策略

ZIP 文件可能较大，不适合整个缓存到 Redis。改为：
- Parse 阶段仅记录 MinIO 的 fileKey 到 Redis：`md_zip:filekey:{id}` → fileKey，TTL 2小时
- Export 阶段从 MinIO 重新下载 ZIP（根据 fileKey），找到目标文件处理
- 这样不需要在 Redis 存大文件，MinIO 本身就是持久存储

---

## 任务分解

### Task 1: 后端 — 新增 CrawlerSource 常量

**Files:**
- Modify: `backend/consts/parse.go`

- [ ] **Step 1: 添加常量和路由**

在 `backend/consts/parse.go` 中：
1. 在 `CrawlerSourceConfluence` 后新增：`CrawlerSourceMdZip CrawlerSource = "md_zip"`
2. 在 `Type()` 方法的 `CrawlerSourceTypeFile` case 中添加 `CrawlerSourceMdZip`

- [ ] **Step 2: 验证编译**

Run: `cd backend && go build ./...`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add backend/consts/parse.go
git commit -m "feat: add CrawlerSourceMdZip constant for markdown zip import"
```

---

### Task 2: 后端 — 实现 MdZipParse 方法

**Files:**
- Modify: `backend/usecase/crawler.go`

- [ ] **Step 1: 在 ParseUrl 的 switch 中新增 md_zip case**

在 `backend/usecase/crawler.go` 的 `ParseUrl()` 方法中，在现有 case 分支后（约 line 220 之后），添加 `case consts.CrawlerSourceMdZip:` 分支，调用新方法 `u.mdZipParse(ctx, req.Key, req.KbID, id)`，将结果赋给 `docs`。

- [ ] **Step 2: 实现 mdZipParse 方法**

在 `crawler.go` 文件末尾（`cleanExcelContent` 之后）新增方法：

```go
func (u *CrawlerUsecase) mdZipParse(ctx context.Context, fileUrl string, kbID string, id string) (anydoc.Child, error)
```

逻辑：
1. 用 HTTP GET 下载 fileUrl 指向的 ZIP 文件到 `[]byte`
2. 用 `archive/zip.NewReader(bytes.NewReader(data), int64(len(data)))` 打开
3. 遍历 `zipReader.File`，过滤出：
   - `.md` 文件 → 创建文档节点（`File: true`，ID 为文件在 ZIP 中的路径）
   - doc2md 支持的格式（复用 `isDoc2mdSupportedFile`）→ 创建文档节点
   - 忽略目录条目和图片等其他文件
4. 构建 `anydoc.Child` 树返回（平铺结构即可，所有文档作为顶级子节点）
5. 缓存 fileUrl 到 Redis：key `md_zip:filekey:{id}`，value 为 `fileUrl`，TTL 2 小时

需要新增 import: `"archive/zip"`

- [ ] **Step 3: 验证编译**

Run: `cd backend && go build ./...`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add backend/usecase/crawler.go
git commit -m "feat: implement mdZipParse for listing documents in zip archive"
```

---

### Task 3: 后端 — 实现 MdZipExport 方法

**Files:**
- Modify: `backend/usecase/crawler.go`

- [ ] **Step 1: 在 ExportDoc 的 switch 中新增 md_zip case**

在 `backend/usecase/crawler.go` 的 `ExportDoc()` 方法中（约 line 457 之前），添加 `case consts.CrawlerSourceMdZip:` 分支，调用 `u.mdZipExport(ctx, req.ID, req.DocID, req.KbID)`，返回其结果。

- [ ] **Step 2: 实现 mdZipExport 方法**

新增方法：

```go
func (u *CrawlerUsecase) mdZipExport(ctx context.Context, platformID string, docID string, kbID string) (*v1.CrawlerExportResp, error)
```

逻辑：
1. 从 Redis 获取 fileUrl：key `md_zip:filekey:{platformID}`
2. HTTP GET 下载 ZIP 文件
3. 打开 ZIP，根据 `docID`（即文件路径）找到目标文件
4. 判断文件类型：

**如果是 .md 文件：**
- 读取 MD 内容为字符串
- 调用 `u.processZipMdImages(ctx, markdown, mdFilePath, zipReader, kbID)` 处理图片
- 生成 syntheticTaskId，缓存到 Redis `doc2md:result:{taskId}`

**如果是 doc2md 支持格式：**
- 从 ZIP 中提取文件内容
- 用 `u.fileUsecase.UploadFileFromBytes()` 上传到 MinIO 临时路径
- 构造 MinIO URL，调用 `u.doc2mdClient.ConvertToMarkdown(ctx, minioUrl)`
- 如果有图片，调用 `u.uploadDoc2mdImages()`
- 生成 syntheticTaskId，缓存结果

5. 返回 `&v1.CrawlerExportResp{TaskId: syntheticTaskId}`

- [ ] **Step 3: 实现 processZipMdImages 辅助方法**

新增方法：

```go
func (u *CrawlerUsecase) processZipMdImages(ctx context.Context, markdown string, mdPath string, zipReader *zip.Reader, kbID string) string
```

逻辑：
1. 用正则匹配 MD 中所有图片引用：`!\[([^\]]*)\]\(([^)]+)\)` 中的路径部分
2. 过滤掉 HTTP/HTTPS 开头的远程图片（`strings.HasPrefix(imgPath, "http")`）
3. 计算 MD 文件所在目录：`mdDir = path.Dir(mdPath)`
4. 对每个本地图片路径：
   a. 计算在 ZIP 中的完整路径：`zipPath = path.Clean(path.Join(mdDir, imgPath))`
   b. **路径穿越安全检查**：如果 `zipPath` 以 `..` 开头或为绝对路径，跳过该图片（防止路径穿越读取 ZIP 外的内容）
   c. 在 `zipReader.File` 中查找该路径
   d. 找到后读取图片内容
   e. 检测 Content-Type（`http.DetectContentType`）
   f. 上传到 MinIO：`s3Key = "{kbID}/{uuid}{ext}"`
   g. 替换 markdown 中的旧路径为 `/static-file/{s3Key}`
5. 返回替换后的 markdown

- [ ] **Step 4: 验证编译**

Run: `cd backend && go build ./...`
Expected: BUILD SUCCESS

- [ ] **Step 5: Commit**

```bash
git add backend/usecase/crawler.go
git commit -m "feat: implement mdZipExport with image extraction and doc2md fallback"
```

---

### Task 4: 后端 — Handler 层适配

**Files:**
- Modify: `backend/handler/v1/crawler.go`

- [ ] **Step 1: 确认 CrawlerParse handler 是否需要改动**

阅读 `backend/handler/v1/crawler.go` 的 `CrawlerParse` 方法（约 line 57-100）。`md_zip` 类型属于 File 类型（需要先上传），前端会传 `key`（文件上传后的 MinIO key）。现有的 handler 验证逻辑中，只需要确保 `md_zip` 不需要特殊参数验证（不需要 Feishu/Dingtalk 的认证参数）。

如果现有 default 分支已经验证了 `key` 必填，则无需改动。如果有遗漏，添加 `md_zip` 到需要 key 的分支。

- [ ] **Step 2: 验证编译并测试**

Run: `cd backend && go build ./...`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit（仅在有改动时）**

```bash
git add backend/handler/v1/crawler.go
git commit -m "feat: add md_zip validation in crawler handler"
```

---

### Task 5: 前端 — 新增枚举值和类型配置

> **注意**：`web/admin/src/request/types.ts` 和 `web/app/src/request/types.ts` 是 Swagger 自动生成的。如果走 `make generate` 流程，需先完成 Task 7（更新后端 Swagger 注释）再执行生成；如果项目实际是手动维护，则直接编辑。

**Files:**
- Modify: `web/admin/src/request/types.ts`（Swagger 生成 或 手动编辑）
- Modify: `web/app/src/request/types.ts`（Swagger 生成 或 手动编辑）
- Modify: `web/admin/src/pages/document/component/AddDocByType/constants.ts`

- [ ] **Step 1: 添加前端枚举值**

在 `web/admin/src/request/types.ts` 的 `ConstsCrawlerSource` 枚举末尾（`CrawlerSourceConfluence` 之后）新增：
```typescript
CrawlerSourceMdZip = "md_zip",
```

在 `web/app/src/request/types.ts` 的 `ConstsCrawlerSource` 枚举末尾新增同样的值。

- [ ] **Step 2: 添加类型配置**

在 `web/admin/src/pages/document/component/AddDocByType/constants.ts` 中：

1. `UPLOAD_FILE_TYPES` 数组末尾添加 `ConstsCrawlerSource.CrawlerSourceMdZip`
2. `PARSE_TYPES` 数组末尾添加 `ConstsCrawlerSource.CrawlerSourceMdZip`（因为 ZIP 内有多个文件需要展示列表让用户选择）
3. `TYPE_CONFIG` 对象中新增配置：
```typescript
[ConstsCrawlerSource.CrawlerSourceMdZip]: {
  label: '通过 Markdown 压缩包导入',
  okText: '导入文档',
  accept: '.zip',
},
```

- [ ] **Step 3: 验证前端编译**

Run: `cd web && pnpm build`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add web/admin/src/request/types.ts web/app/src/request/types.ts web/admin/src/pages/document/component/AddDocByType/constants.ts
git commit -m "feat: add md_zip type config in frontend constants"
```

---

### Task 6: 前端 — 添加菜单入口

**Files:**
- Modify: `web/admin/src/pages/document/component/AddDocBtn.tsx`

- [ ] **Step 1: 添加菜单项**

在 `AddDocBtn.tsx` 的 `menuItems` 数组中，在 `CrawlerSourceConfluence` 条目之后（约 line 166 之后），新增：

```typescript
{
  key: ConstsCrawlerSource.CrawlerSourceMdZip,
  label: '通过 Markdown 压缩包导入',
  onClick: () => {
    setUploadOpen(true);
    setKey(ConstsCrawlerSource.CrawlerSourceMdZip);
  },
},
```

- [ ] **Step 2: 验证前端编译**

Run: `cd web && pnpm build`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add web/admin/src/pages/document/component/AddDocBtn.tsx
git commit -m "feat: add markdown zip import menu entry"
```

---

### Task 7: 后端 — Swagger 注释更新与代码生成

> **已确认**：前端 `request/types.ts` 文件头标注为 Swagger 自动生成。如果走 generate 流程，此 Task 应在 Task 5 Step 1 之前执行（先更新后端注释 → `make generate` → 前端 types.ts 自动包含 `md_zip`）。

**Files:**
- Modify: 后端 Swagger 注释文件

- [ ] **Step 1: 找到 CrawlerSource 枚举的 Swagger 定义位置**

在后端代码中搜索 `CrawlerSource` 相关的 Swagger 注释（`@enum` 或 `enums` 标注），通常在 `backend/consts/parse.go` 或 `backend/api/` 目录下。添加 `md_zip` 到枚举列表。

- [ ] **Step 2: 运行 `make generate` 重新生成**

执行 `make generate`，检查生成的 `web/admin/src/request/types.ts` 和 `web/app/src/request/types.ts` 是否包含 `CrawlerSourceMdZip`。

- [ ] **Step 3: Commit（仅在有改动时）**

```bash
git add -A
git commit -m "feat: update swagger annotations for md_zip source"
```

---

### Task 8: 集成测试

- [ ] **Step 1: 后端编译验证**

Run: `cd backend && go build ./...`
Expected: BUILD SUCCESS

- [ ] **Step 2: 前端编译验证**

Run: `cd web && pnpm build`
Expected: BUILD SUCCESS

- [ ] **Step 3: 手动测试准备**

创建测试用 ZIP 包结构：
```
test-import.zip
├── 文档A.md          # 内容中引用 images/img1.png
├── 文档B.md          # 内容中引用 ./images/img2.png
├── images/
│   ├── img1.png
│   └── img2.png
└── report.docx       # 非 MD 文件，走 doc2md 转换
```

- [ ] **Step 4: 功能验证清单**

1. 管理后台菜单中出现 "通过 Markdown 压缩包导入" 选项
2. 点击后弹出文件选择框，仅接受 .zip 文件
3. 上传 ZIP 后，显示文件列表（MD 文件和 docx 文件）
4. 不显示图片文件
5. 选择文档后点击导入
6. MD 文件中的图片正确替换为 MinIO URL
7. docx 文件通过 doc2md 转换为 Markdown
8. 文档节点成功创建

---

## 注意事项

1. **ZIP 文件大小限制**：继承现有文件上传限制（100MB），ZIP 解压后在内存中处理，注意大文件 OOM 风险。建议对 ZIP 内单个文件设置合理上限。

2. **图片路径安全**：`path.Clean()` 处理后需检查：(a) 路径不以 `..` 开头；(b) 不是绝对路径。两者都是路径穿越的信号，应跳过该图片。已在 Task 3 Step 3 中体现。

3. **编码问题（待定）**：ZIP 内文件名可能为 GBK 编码（Windows 打包），需考虑 `golang.org/x/text/encoding` 进行检测和转换。第一版可暂不处理，后续遇到再补。

4. **Redis 缓存 TTL**：与现有 doc2md 缓存保持一致使用 2 小时，确保用户有足够时间完成导入操作。

5. **复用 ScrapeGetResult**：Export 结果缓存使用 `doc2md:result:{taskId}` 格式，与现有 doc2md 缓存键一致，不需要改动 `ScrapeGetResult` 查询逻辑。

6. **前端流程复用**：`md_zip` 加入 `UPLOAD_FILE_TYPES`（需要上传）和 `PARSE_TYPES`（显示文件列表供选择），前端现有的 上传→解析→展示列表→批量导入 流程完全复用。
