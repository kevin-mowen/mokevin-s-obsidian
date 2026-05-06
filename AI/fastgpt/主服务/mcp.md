# MCP（Model Context Protocol）学习总结

## 一、MCP 概述

MCP（Model Context Protocol）是 Anthropic 推出的**模型上下文协议**，用于标准化 AI 模型与外部工具/数据的交互方式。

### 核心价值

```
传统方式：每个工具都需要单独集成，接口各异
MCP 方式：统一协议，工具即插即用，AI 自主调用
```

### 核心理念

**AI 自主决策** —— MCP 的价值在于配合具备 Tool Use 能力的 AI 模型：
- AI 理解用户意图
- AI 根据工具描述判断是否调用
- AI 自动生成调用参数
- AI 汇总结果返回给用户

---

## 二、MCP 架构

### 角色划分

| 角色 | 说明 | 示例 |
|------|------|------|
| **MCP Host** | 运行 AI 模型的应用 | Claude Desktop、FastGPT |
| **MCP Client** | 与 Server 通信的客户端 | 内置于 Host 中 |
| **MCP Server** | 提供工具/资源的服务 | 文件系统、数据库、API 适配层 |

### 通信流程

```
用户输入
    ↓
MCP Host（AI 模型）
    ↓ 决策调用
MCP Client
    ↓ 协议通信
MCP Server
    ↓ 执行操作
外部系统/API
```

---

## 三、MCP 三大能力

| 能力 | 说明 | 用途 |
|------|------|------|
| **Tools（工具）** | 可执行的操作 | 查询数据、发送消息、创建文件 |
| **Resources（资源）** | 可读取的数据 | 数据库内容、配置文件、文档 |
| **Prompts（提示模板）** | 预定义的提示词 | 标准化常用提示，确保一致性 |

---

## 四、传输协议

### 1. Stdio（标准输入输出）
- 用于本地进程间通信
- Claude Desktop 默认使用
- 配置示例：
```json
{
  "mcpServers": {
    "server-name": {
      "command": "node",
      "args": ["server.js"]
    }
  }
}
```

### 2. SSE（Server-Sent Events）
- 基于 HTTP 的服务器推送
- 适合 Web 环境
- 需要两个端点：`/sse`（事件流）+ `/messages`（消息）

### 3. Streamable HTTP
- 新版 HTTP 传输方式
- 单一端点，更简洁
- FastGPT 优先使用此方式

---

## 五、FastGPT 中的 MCP

### 双重角色

| 功能位置 | MCP 角色 | 作用 |
|---------|----------|------|
| Dashboard → MCP服务 | **Server** | 将 FastGPT 应用暴露给外部调用 |
| 应用 → 工具 → MCP工具 | **Client** | 调用外部 MCP Server |

### FastGPT 作为 MCP Server

**连接方式**：
- Streamable HTTP：`http://host:port/api/mcp/app/{key}/mcp`
- SSE（需代理）：`http://mcp-server:3000/{key}/sse`

**Claude Desktop 配置**：
```json
{
  "mcpServers": {
    "fastgpt": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/llm/api/mcp/app/{key}/mcp"]
    }
  }
}
```

### FastGPT 作为 MCP Client

**配置步骤**：
1. 应用详情 → 工具 → 新建 → MCP 工具
2. 填入 MCP Server 地址
3. 点击「解析」获取工具列表
4. 勾选需要的工具
5. 在工作流中使用

---

## 六、第三方 API 接入 MCP

### 场景
第三方系统只有 REST API，需要封装成 MCP Server 供 FastGPT 调用。

### 流程
```
第三方 API → MCP Server（适配层） → FastGPT MCP 工具 → 工作流
```

### 适配层代码示例

```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";

const API_BASE = "https://third-party.com";
const API_TOKEN = process.env.API_TOKEN;

const server = new McpServer({
  name: "api-adapter",
  version: "1.0.0"
});

// 注册工具
server.tool(
  "search_users",           // 工具名称
  "搜索用户列表",            // 工具描述（AI 根据此判断是否调用）
  {                         // inputSchema（参数定义）
    keyword: { type: "string", description: "搜索关键词" },
    page: { type: "number", description: "页码，默认1" }
  },
  async ({ keyword, page = 1 }) => {  // 执行函数
    const result = await fetch(
      `${API_BASE}/api/users?keyword=${keyword}&page=${page}`,
      { headers: { Authorization: `Bearer ${API_TOKEN}` } }
    ).then(r => r.json());

    return {
      content: [{ type: "text", text: JSON.stringify(result) }]
    };
  }
);

// 启动 SSE 服务
const app = express();
app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});
app.listen(3006);
```

### 参数处理要点

| 环节 | 处理方式 |
|------|---------|
| 参数定义 | MCP Server 的 `inputSchema` |
| 必填标记 | `required` 数组 |
| 默认值 | 代码中设置 `page = 1` |
| 字段映射 | MCP 参数名 → API 字段名转换 |

---

## 七、MCP 工具解析结果示例

当 FastGPT 解析 MCP Server 地址后，获取的工具列表格式：

```json
[
  {
    "name": "search_users",
    "description": "搜索用户列表",
    "inputSchema": {
      "type": "object",
      "properties": {
        "keyword": {
          "type": "string",
          "description": "搜索关键词"
        },
        "page": {
          "type": "number",
          "description": "页码"
        }
      },
      "required": ["keyword"]
    }
  }
]
```

---

## 八、关键配置

### FastGPT 配置文件 (config.json)

```json
{
  "feConfigs": {
    "mcpServerProxyEndpoint": "http://localhost:3005"
  }
}
```

### Docker 配置

```yaml
fastgpt-mcp-server:
  image: ghcr.io/labring/fastgpt-mcp_server:v4.10.1
  ports:
    - 3005:3000
  environment:
    # 注意：容器内访问宿主机要用 host.docker.internal
    - FASTGPT_ENDPOINT=http://host.docker.internal:3000/llm
```

---

## 九、常见问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| Claude Desktop 报 command required | 配置格式错误 | 使用 mcp-remote 代理 |
| 404 Not Found | URL 路径错误 | 检查是否有子路径（如 /llm） |
| MCP Server 连接失败 | Docker 网络问题 | localhost → host.docker.internal |
| Node 版本过低 | mcp-remote 要求 >=20.18.1 | 升级 Node.js |

---

## 十、MCP 生态

### 常用 MCP Server

| Server | 功能 |
|--------|------|
| @modelcontextprotocol/server-filesystem | 文件系统操作 |
| @modelcontextprotocol/server-github | GitHub 仓库操作 |
| @modelcontextprotocol/server-postgres | 数据库查询 |
| @modelcontextprotocol/server-slack | Slack 消息 |
| @modelcontextprotocol/server-puppeteer | 浏览器自动化 |

---

## 十一、总结

**MCP 的本质**：
- 不是简单的 API 封装
- 是 **AI + 工具** 的标准化协议
- 让 AI 能够**自主发现、自主决策、自主调用**外部能力

**FastGPT 中的应用**：
- 对外：作为 MCP Server，让 Claude 等调用 FastGPT 工作流
- 对内：作为 MCP Client，在工作流中调用外部 MCP 工具

---

## 相关代码路径

| 文件 | 说明 |
|------|------|
| `projects/mcp_server/` | FastGPT MCP Server 实现 |
| `packages/service/core/app/mcp.ts` | MCP Client 实现 |
| `projects/app/src/pages/api/mcp/` | MCP API 路由 |
| `projects/app/src/pages/api/support/mcp/` | MCP 工具管理 API |
