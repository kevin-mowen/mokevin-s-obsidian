# FastGPT iframe 嵌入指南

本文档详细介绍 FastGPT 应用的 iframe 嵌入功能，包括实现原理、使用方式和配置参数。

---

## 1. 概述

FastGPT 支持三种方式将应用嵌入到其他网站：

| 方式 | 说明 | 适用场景 |
|------|------|----------|
| **直接链接** | 生成可访问的 Web 链接 | 独立页面访问 |
| **iframe 嵌入** | 使用 `<iframe>` 标签嵌入 | 网页内嵌对话窗口 |
| **Script 嵌入** | 使用 `<script>` 标签嵌入 | 悬浮机器人按钮 |

iframe 嵌入和 Script 嵌入都基于**分享链接**机制，共用同一套 OutLink 数据模型。

---

## 2. 嵌入方式详解

### 2.1 iframe 嵌入

最基础的嵌入方式，将对话界面直接嵌入到页面中。

**代码示例**：

```html
<iframe
  src="https://your-domain.com/chat/share?shareId=YOUR_SHARE_ID"
  style="width: 100%; height: 100%;"
  frameborder="0"
  allow="microphone *; *"
/>
```

**参数说明**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `shareId` | string | 分享链接 ID（24 位 nanoid） |
| `showHistory` | `0` \| `1` | 是否显示历史记录（默认 `1`） |

**完整 URL 格式**：

```
https://your-domain.com/chat/share?shareId=xxx&showHistory=1
```

### 2.2 Script 嵌入（悬浮机器人）

通过 Script 标签嵌入一个悬浮机器人按钮，点击后弹出对话窗口。

**代码示例**：

```html
<script
  type="text/javascript"
  src="https://your-domain.com/js/iframe.js"
  id="chatbot-iframe"
  data-bot-src="https://your-domain.com/chat/share?shareId=YOUR_SHARE_ID"
  data-default-open="false"
  data-drag="false"
  data-open-icon="data:image/svg+xml;base64,..."
  data-close-icon="data:image/svg+xml;base64,..."
  defer
></script>
```

**Script 参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | string | `chatbot-iframe` | **必填**，脚本标识 |
| `data-bot-src` | string | - | **必填**，对话页面 URL |
| `data-default-open` | `true` \| `false` | `false` | 首次加载是否自动打开对话窗口 |
| `data-drag` | `true` \| `false` | `false` | 悬浮按钮是否可拖动 |
| `data-open-icon` | string | 默认图标 | 未打开时的按钮图标（Base64 或 URL） |
| `data-close-icon` | string | 默认图标 | 打开后的关闭按钮图标（Base64 或 URL） |
| `data-init-by-host` | `true` \| `false` | `false` | 是否由宿主页面控制初始化 |

---

## 3. 实现原理

### 3.1 文件结构

```text
projects/app/
├── public/js/
│   └── iframe.js                    # 悬浮机器人脚本
├── src/pages/chat/
│   └── share.tsx                    # 分享对话页面
└── src/pageComponents/app/detail/Publish/
    └── Link/
        └── SelectUsingWayModal.tsx  # 使用方式选择弹窗
```

### 3.2 iframe.js 核心逻辑

**文件位置**: `projects/app/public/js/iframe.js`

Script 嵌入的核心脚本，负责：

1. **解析参数**：从 `<script>` 标签读取 `data-*` 属性
2. **创建悬浮按钮**：在页面右下角创建可点击的机器人图标
3. **创建对话窗口**：动态创建 iframe 加载对话页面
4. **窗口控制**：支持显示/隐藏、放大/缩小、拖拽
5. **消息通信**：通过 `postMessage` 与 iframe 内页面通信

**关键元素 ID**：

| ID | 说明 |
|----|------|
| `chatbot-window` | 对话窗口 iframe |
| `chatbot-button` | 悬浮按钮容器 |
| `chatbot-button-img` | 悬浮按钮图片 |
| `size-toggle-button` | 窗口大小切换按钮 |

**窗口尺寸状态**：

```javascript
sizeStates = {
  default: { width: '24vw', height: '75vh' },   // 默认尺寸
  expanded: { width: '80vw', height: '80vh' }   // 展开尺寸
};
```

### 3.3 消息通信机制

iframe 与宿主页面通过 `postMessage` 进行通信：

**宿主 → iframe 消息**：

| action | 说明 |
|--------|------|
| `CHAT_BTN_FIRST_CLICKED` | 首次点击悬浮按钮，触发认证流程 |
| `CHAT_COMPLETIONS` | 发送对话请求 |

**iframe → 宿主消息**：

| action / type | 说明 |
|---------------|------|
| `shareChatReady` | iframe 内页面加载完成 |
| `REMOVE_IFRAME` | 请求移除 iframe |
| `CREATE_IFRAME` | 请求创建 iframe |
| `SHOW_CHAT_WINDOW` | 显示对话窗口 |
| `HIDE_CHAT_WINDOW` | 隐藏对话窗口 |
| `HIDE_IFRAME` | 隐藏整个 iframe 组件 |
| `SHOW_IFRAME` | 显示整个 iframe 组件 |

### 3.4 延迟加载机制

为减少服务器压力，Script 嵌入采用延迟加载策略：

1. 页面加载时只创建悬浮按钮，不创建 iframe
2. 用户首次点击按钮时才创建 iframe
3. 例外：如果 `data-default-open="true"`，则立即创建并显示 iframe

```javascript
// 延迟加载逻辑
if (defaultOpen) {
  createChatWindow();
  iframeCreated = true;
  setChatWindowVisibility('unset');
}
```

---

## 4. 配置选项

### 4.1 OutLink 配置

iframe 嵌入共用 OutLink 数据模型，支持以下配置：

**显示配置**：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `responseDetail` | boolean | `false` | 是否返回详细响应 |
| `showNodeStatus` | boolean | `true` | 是否显示节点执行状态 |
| `showRawSource` | boolean | - | 是否显示完整引用来源 |

**限制配置**：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxUsagePoints` | number | `-1` | 最大可用积分（-1 无限制） |
| `expiredTime` | Date | - | 过期时间 |
| `QPM` | number | `1000` | 每分钟请求数限制 |
| `hookUrl` | string | - | 身份验证回调 URL |

### 4.2 URL 参数

分享链接支持的 URL 参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| `shareId` | string | 分享链接 ID |
| `showHistory` | `0` \| `1` | 是否显示历史记录 |
| `authToken` | string | 认证 Token（可选） |
| `customUid` | string | 自定义用户 ID（可选） |

---

## 5. 使用场景

### 5.1 嵌入到网页固定区域

使用 iframe 嵌入，适合将对话界面作为页面的一部分：

```html
<div style="width: 400px; height: 600px;">
  <iframe
    src="https://your-domain.com/chat/share?shareId=xxx&showHistory=0"
    style="width: 100%; height: 100%; border: none; border-radius: 8px;"
    allow="microphone"
  />
</div>
```

### 5.2 悬浮客服机器人

使用 Script 嵌入，在页面右下角显示可点击的机器人图标：

```html
<script
  type="text/javascript"
  src="https://your-domain.com/js/iframe.js"
  id="chatbot-iframe"
  data-bot-src="https://your-domain.com/chat/share?shareId=xxx"
  data-default-open="false"
  data-drag="true"
  defer
></script>
```

### 5.3 自动打开对话

设置 `data-default-open="true"` 使页面加载时自动打开对话窗口：

```html
<script
  type="text/javascript"
  src="https://your-domain.com/js/iframe.js"
  id="chatbot-iframe"
  data-bot-src="https://your-domain.com/chat/share?shareId=xxx"
  data-default-open="true"
  defer
></script>
```

---

## 6. 高级用法

### 6.1 通过 postMessage 控制

宿主页面可以通过 postMessage 控制 iframe：

```javascript
// 发送对话消息
const chatWindow = document.getElementById('chatbot-window');
chatWindow.contentWindow.postMessage({
  action: 'CHAT_COMPLETIONS',
  data: { message: '你好' }
}, '*');

// 显示/隐藏窗口
window.postMessage({ action: 'SHOW_CHAT_WINDOW' }, '*');
window.postMessage({ action: 'HIDE_CHAT_WINDOW' }, '*');
```

### 6.2 自定义图标

支持使用 Base64 或 URL 自定义悬浮按钮图标：

```html
<script
  ...
  data-open-icon="https://your-domain.com/icons/chat.png"
  data-close-icon="https://your-domain.com/icons/close.png"
></script>
```

### 6.3 由宿主控制初始化

设置 `data-init-by-host="true"` 后，可由宿主页面控制何时创建 iframe：

```html
<script
  ...
  data-init-by-host="true"
></script>

<script>
// 在需要时触发创建
window.postMessage({ action: 'CREATE_IFRAME_BY_HOST' }, '*');
</script>
```

---

## 7. 注意事项

1. **跨域限制**：iframe 嵌入受同源策略限制，需确保域名配置正确
2. **HTTPS 要求**：生产环境建议使用 HTTPS
3. **麦克风权限**：如需语音输入，需在 iframe 的 `allow` 属性中声明 `microphone`
4. **移动端适配**：Script 嵌入的悬浮按钮在移动端会自动适应

---

## 8. 相关文件

| 文件 | 说明 |
|------|------|
| `projects/app/public/js/iframe.js` | 悬浮机器人脚本 |
| `projects/app/src/pages/chat/share.tsx` | 分享对话页面 |
| `packages/global/support/outLink/constant.ts` | OutLink 常量定义 |
| `packages/global/support/outLink/type.d.ts` | OutLink 类型定义 |
| `projects/app/src/pageComponents/app/detail/Publish/Link/SelectUsingWayModal.tsx` | 使用方式选择弹窗 |
