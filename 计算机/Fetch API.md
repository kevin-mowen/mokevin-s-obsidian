# Fetch API 详解

## 一、什么是 fetch

`fetch` 是浏览器内置的函数，用来**发送 HTTP 请求**。用 JavaScript 代码去"访问一个网址"，拿到数据，不需要刷新页面。

```javascript
fetch('https://api.example.com/data')
```

这一行就向目标地址发了一个 GET 请求。

---

## 二、异步与 Promise

网络请求需要时间，JavaScript 不会傻等着。`fetch` 返回一个 **Promise**（承诺），表示"结果回来后会通知你"。

### 写法一：`.then()` 链式调用

```javascript
fetch('https://api.example.com/data')
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('请求失败:', error));
```

### 写法二：`async/await`（推荐，更直观）

```javascript
async function getData() {
  try {
    const response = await fetch('https://api.example.com/data');
    const data = await response.json();
    console.log(data);
  } catch (error) {
    console.error('请求失败:', error);
  }
}
```

`await` 的意思是"等这个操作完成再往下走"，代码看起来像同步的，实际上是异步的。两种写法效果完全一样。

---

## 三、各种请求方法

### 3.1 GET 请求（获取数据）

```javascript
// 最简单的 GET
const response = await fetch('https://api.example.com/users');
const users = await response.json();
```

**带参数的 GET 请求：**

```javascript
const params = new URLSearchParams({ id: 1, name: '张三' });
const response = await fetch(`https://api.example.com/users?${params}`);
```

### 3.2 POST 请求（发送数据）

```javascript
const response = await fetch('https://api.example.com/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',    // 告诉服务器发的是 JSON
  },
  body: JSON.stringify({                   // 要发送的数据
    username: 'zhangsan',
    password: '123456',
  }),
});

const result = await response.json();
```

- `method: 'POST'`：指定请求方法（默认是 GET）
- `headers`：请求头，`Content-Type` 说明数据格式
- `body`：请求体，用 `JSON.stringify()` 把对象转成 JSON 字符串

### 3.3 PUT 请求（更新数据）

```javascript
const response = await fetch('https://api.example.com/users/1', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '李四', age: 25 }),
});
```

### 3.4 DELETE 请求（删除数据）

```javascript
const response = await fetch('https://api.example.com/users/1', {
  method: 'DELETE',
});
```

---

## 四、Response 对象

`fetch` 返回的 `response` 是整个响应的"信封"，需要从中取出数据。

```javascript
const response = await fetch(url);

// --- 响应信息 ---
response.status;      // 状态码：200、404、500
response.ok;          // 布尔值，status 在 200-299 之间为 true
response.statusText;  // 状态文字："OK"、"Not Found"
response.headers;     // 响应头

// --- 取出数据（只能调用一次！） ---
await response.json();       // 解析为 JSON 对象（最常用）
await response.text();       // 解析为纯文本字符串
await response.blob();       // 解析为二进制数据（文件下载）
await response.formData();   // 解析为 FormData
```

> 注意：json()、text() 等方法**只能调用一次**，因为响应体是一个流，读过一次就没了。

---

## 五、错误处理（重要！）

### 容易踩的坑

**HTTP 错误状态码（如 404、500）不会触发 catch！**

`fetch` 的设计：只要服务器有响应，就算成功。404 也是一种"成功的响应"。只有网络错误（断网、DNS 失败）才会触发 catch。

### 正确写法

```javascript
async function fetchData(url) {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP 错误！状态码: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('请求失败:', error.message);
  }
}
```

---

## 六、常见实战场景

### 6.1 带 Token 的认证请求

```javascript
const response = await fetch('https://api.example.com/profile', {
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});
```

### 6.2 上传文件

```javascript
const formData = new FormData();
formData.append('avatar', file);
formData.append('username', 'zhangsan');

const response = await fetch('https://api.example.com/upload', {
  method: 'POST',
  body: formData,
  // 不要手动设置 Content-Type！浏览器会自动设置
});
```

### 6.3 超时控制（AbortController）

```javascript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);

try {
  const response = await fetch('https://api.example.com/slow-api', {
    signal: controller.signal,
  });
  clearTimeout(timeoutId);
  const data = await response.json();
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('请求超时了！');
  }
}
```

### 6.4 流式读取（用于 AI 对话）

配合 `ReadableStream`，可以实现流式输出（参考 [[SSE]] 笔记）：

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

关键点：
- `response.body` 是一个 `ReadableStream`（可读流）
- `.getReader()` 拿到读取器
- `reader.read()` 每次读一块数据，循环直到 `done` 为 `true`

---

## 七、所有配置项一览

```javascript
fetch(url, {
  method: 'POST',              // GET | POST | PUT | DELETE | PATCH
  headers: {                   // 请求头
    'Content-Type': 'application/json',
    'Authorization': 'Bearer xxx',
  },
  body: JSON.stringify(data),  // 请求体（GET/HEAD 不能有 body）
  mode: 'cors',                // cors | no-cors | same-origin
  credentials: 'include',     // cookie 策略：omit | same-origin | include
  cache: 'no-cache',          // 缓存策略
  redirect: 'follow',         // 重定向：follow | error | manual
  signal: controller.signal,  // 用于取消请求
});
```

常用的主要是 `method`、`headers`、`body`、`credentials`、`signal`。

---

## 八、fetch vs XMLHttpRequest

|            | fetch               | XMLHttpRequest |
| ---------- | ------------------- | -------------- |
| 语法         | 简洁，基于 Promise       | 繁琐，基于回调        |
| 流式读取       | 支持 ReadableStream   | 不支持            |
| 取消请求       | AbortController     | xhr.abort()    |
| 默认带 cookie | 不带（需设置 credentials） | 同域默认带          |
| 上传进度       | 不支持                 | 支持 onprogress  |

现在基本都用 fetch，除非需要上传进度条功能。

---

## 总结

**`fetch` 就是用 JavaScript 代码发 HTTP 请求的工具。**

最核心的用法三步：

```javascript
const response = await fetch(url, options);  // 1. 发请求
if (!response.ok) throw new Error('失败');    // 2. 检查状态
const data = await response.json();           // 3. 取数据
```