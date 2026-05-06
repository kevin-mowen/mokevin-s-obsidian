# SSE（Server-Sent Events）流式输出详解

## 一、什么是 SSE

SSE（Server-Sent Events）是一种**服务器向浏览器单向推送数据**的技术。基于 HTTP 协议，非常轻量。

**核心特点：**
- 基于 HTTP 协议
- **单向通信**：只能服务器 → 客户端（与 WebSocket 最大的区别）
- 客户端通过 `EventSource` API 监听
- 自动重连、支持事件 ID

**典型使用场景：**
- ChatGPT / Claude 的流式输出（文字一个字一个字蹦出来）
- 实时通知推送
- 股票行情、新闻更新

---

## 二、为什么需要流式输出

### 传统 HTTP 请求的过程

浏览器向服务器发请求，服务器返回数据，**一问一答，结束，连接关闭**。

就像去餐厅点菜：你点了一道菜（请求），厨房做好后一次性端上来（响应），这单就结束了。

### 传统模式的问题

**场景 1：AI 聊天**

你问 Claude 一个问题，Claude 需要 8 秒才能生成完整答案。

传统模式下：

```
你：什么是量子力学？
（8秒过去了......屏幕空白......）
Claude：（突然出现一大段文字）
```

用户会想："卡了？挂了？"

**场景 2：实时通知**

比如体育比分网站，比分随时会变。传统模式下，浏览器只能**不停地问服务器**（轮询 Polling），非常浪费资源。

### SSE 的思路

**服务器可以主动、持续地向客户端推送数据。**

比喻：
- **传统模式** = 你点一道菜，厨房做好，端上来，结束。
- **SSE** = 你点了一个"自助传送带"，厨房不断地往传送带上放菜，你坐着等菜自己过来就行。

用在 AI 聊天上：

```
你：什么是量子力学？
（0.1秒后）Claude 推送：量子
（0.2秒后）Claude 推送：力学
（0.3秒后）Claude 推送：是
（0.4秒后）Claude 推送：研究
...
```

---

## 三、SSE vs WebSocket 对比

| | SSE | WebSocket |
|---|---|---|
| 方向 | 单向（服务器→客户端） | 双向 |
| 协议 | HTTP | 独立的 ws:// 协议 |
| 复杂度 | 简单，开箱即用 | 较复杂，需要握手 |
| 重连 | 自动 | 需要自己实现 |
| 适用场景 | 推送通知、流式输出 | 聊天室、游戏、协作编辑 |

**简单说：如果只需要服务器单向推数据，用 SSE 就够了，比 WebSocket 简单得多。**

---

## 四、动手写一个最简单的 SSE

### 4.1 服务端代码（Node.js）

创建文件 `server.js`：

```javascript
const http = require('http');

const server = http.createServer((req, res) => {

  // 如果访问 /stream，就返回 SSE 流
  if (req.url === '/stream') {

    // 这三个 header 是 SSE 的关键！
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',  // 告诉浏览器：这是一个事件流
      'Cache-Control': 'no-cache',           // 不要缓存
      'Connection': 'keep-alive',            // 保持连接不断开
      'Access-Control-Allow-Origin': '*',    // 允许跨域（开发用）
    });

    // 模拟 AI 逐字输出
    const message = '你好，我是AI助手，很高兴认识你！';
    const chars = message.split('');
    let index = 0;

    const timer = setInterval(() => {
      if (index < chars.length) {
        // SSE 的数据格式：必须以 "data: " 开头，以两个换行结尾
        res.write(`data: ${JSON.stringify({ text: chars[index] })}\n\n`);
        index++;
      } else {
        // 发完了，发一个结束信号
        res.write(`data: [DONE]\n\n`);
        clearInterval(timer);
        res.end();
      }
    }, 200); // 每200毫秒发一个字

    return;
  }

  // 其他请求返回 404
  res.writeHead(404);
  res.end('Not Found');
});

server.listen(3000, () => {
  console.log('服务器启动了：http://localhost:3000');
});
```

**关键部分解释：**

- `'Content-Type': 'text/event-stream'`：SSE 的"身份证"，浏览器看到就知道这是一个持续的事件流
- `res.write()`：不是 `res.end()`！表示"我还没写完，先发这一块"
- 数据格式：每条消息以 `data: ` 开头，以两个换行符 `\n\n` 结尾

实际发出去的内容长这样：

```
data: {"text":"你"}

data: {"text":"好"}

data: {"text":"，"}

data: [DONE]
```

### 4.2 客户端代码

创建文件 `index.html`：

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>SSE 流式输出演示</title>
  <style>
    body {
      font-family: sans-serif;
      max-width: 600px;
      margin: 50px auto;
    }
    #output {
      border: 1px solid #ccc;
      padding: 20px;
      min-height: 100px;
      font-size: 18px;
      line-height: 1.6;
      white-space: pre-wrap;
    }
    button {
      margin-bottom: 10px;
      padding: 8px 16px;
      font-size: 16px;
    }
    #status {
      color: gray;
      font-size: 14px;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <h1>SSE 流式输出演示</h1>
  <button onclick="startStream()">开始接收</button>
  <div id="output"></div>
  <div id="status"></div>

  <script>
    function startStream() {
      // 清空之前的内容
      document.getElementById('output').innerText = '';
      document.getElementById('status').innerText = '连接中...';

      // 创建 EventSource —— 浏览器内置的 SSE 客户端
      const source = new EventSource('http://localhost:3000/stream');

      // 连接成功时触发
      source.onopen = () => {
        document.getElementById('status').innerText = '已连接，接收数据中...';
      };

      // 每收到一条消息就触发
      source.onmessage = (event) => {
        // 检查是否结束
        if (event.data === '[DONE]') {
          source.close(); // 关闭连接
          document.getElementById('status').innerText = '完成！';
          return;
        }

        // 解析数据，追加到页面上
        const data = JSON.parse(event.data);
        document.getElementById('output').innerText += data.text;
      };

      // 出错时触发
      source.onerror = () => {
        document.getElementById('status').innerText = '连接断开';
        source.close();
      };
    }
  </script>
</body>
</html>
```

**关键部分解释：**

- `new EventSource(url)`：浏览器**原生内置**的 API，专门用来接收 SSE，传入 URL 即可自动建立连接
- `source.onmessage`：每当服务器发来一条 `data: xxx` 消息就会触发，`event.data` 就是 `data:` 后面的内容

### 4.3 运行方式

1. 打开终端，运行服务端：`node server.js`
2. 用浏览器直接打开 `index.html`（双击文件即可）
3. 点击"开始接收"按钮，即可看到文字逐字出现

---

## 五、整个过程的时间线

```
时间线：

0ms     浏览器 → 服务器：GET /stream（建立连接）
        服务器 → 浏览器：200 OK, Content-Type: text/event-stream

200ms   服务器 → 浏览器：data: {"text":"你"}
        页面显示：你

400ms   服务器 → 浏览器：data: {"text":"好"}
        页面显示：你好

600ms   服务器 → 浏览器：data: {"text":"，"}
        页面显示：你好，

800ms   服务器 → 浏览器：data: {"text":"我"}
        页面显示：你好，我

...

        服务器 → 浏览器：data: [DONE]
        浏览器关闭连接，显示"完成！"
```

---

## 六、SSE 的数据格式详解

SSE 的协议是纯文本，有几个字段：

```
data: 消息内容        ← 数据（必须有）
id: 123              ← 消息ID（可选，用于断线重连）
event: customEvent   ← 自定义事件名（可选）
retry: 5000          ← 重连间隔，毫秒（可选）
```

**多行数据：**

```
data: 第一行
data: 第二行
```

客户端收到的 `event.data` 会是 `"第一行\n第二行"`。

**自定义事件：**

服务端：

```
event: score-update
data: {"home": 2, "away": 1}
```

客户端：

```javascript
source.addEventListener('score-update', (event) => {
  const score = JSON.parse(event.data);
  console.log(`比分：${score.home} : ${score.away}`);
});
```

---

## 七、流式输出的其他实现方式

### 7.1 fetch + ReadableStream

SSE 的 `EventSource` 只支持 GET 请求。但很多场景（比如发送聊天消息）需要 POST，这时候用 `fetch` 配合流式读取：

```javascript
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: '你好' }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

let fullText = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value, { stream: true });
  fullText += chunk;
  document.getElementById('output').innerText = fullText;
}
```

**这种方式更灵活，是目前 AI 产品最主流的做法。**

### 7.2 WebSocket

双向通信，适合更复杂的场景（如实时协作、游戏）。对于单纯的流式输出来说有点"杀鸡用牛刀"。

---

## 八、流式 vs 非流式对比

| | 非流式 | 流式 |
|---|---|---|
| 用户等待感 | 长时间空白，突然全部出现 | 几乎立刻看到内容 |
| 首字节时间（TTFB） | 慢（等全部生成完） | 快（生成第一个字就返回） |
| 实现复杂度 | 简单 | 稍复杂 |
| 适用场景 | 短响应、非实时 | AI 对话、实时推送、大数据量 |

---

## 九、为什么 AI 对话一定要用流式

大语言模型生成一段 500 字的回答可能需要 5-10 秒。不用流式的话用户要干等 10 秒，用流式则第一个 token（大约几十毫秒）就能返回。

而且模型本身就是**逐 token 生成**的（一个字一个字地预测下一个），天然适合流式输出——生成一个就发一个，不需要等全部生成完。

---

## 十、SSE 的优缺点

**优点：**
- 极其简单，基于 HTTP，不需要额外协议
- 浏览器原生支持 `EventSource`，不需要引入任何库
- 自动重连（连接断了浏览器会自动尝试重新连接）
- 轻量，适合服务器单向推送

**缺点：**
- 只能服务器 → 客户端（单向），客户端想发消息还得另外发 HTTP 请求
- `EventSource` 只支持 GET 请求（想用 POST 就得用 `fetch` + `ReadableStream`）
- 每个浏览器对同一域名的 SSE 连接数有限制（HTTP/1.1 下通常是 6 个）

---

## 总结

**SSE 就是服务器通过一个不关闭的 HTTP 连接，持续地一条条地向浏览器发送数据。**

```
浏览器 EventSource → HTTP 长连接 → 服务器 res.write() 不断写入
                                  → 浏览器 onmessage 不断接收
                                  → 页面实时更新
```

这就是你在 Claude / ChatGPT 上看到文字逐渐出现的原理。