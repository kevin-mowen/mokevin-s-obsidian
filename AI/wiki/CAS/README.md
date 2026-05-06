# CAS 单点登录接口文档（外部参考资料）

> **⚠️ 重要说明**：本文档是**来自 FastGPT 项目的 CAS 实现**，并非 PandaWiki 自身的实现。保留作为外部参考。
>
> **PandaWiki 的实际 CAS 实现位置**：
> - 后端：`backend/usecase/auth_cas.go`、`backend/handler/share/` 相关文件
> - 单元测试：`backend/usecase/auth_cas_test.go`
> - 配置项：`backend/config/config.local.yml` 的 `cas.url` / `cas.version`
> - 相关二开日志（真实实现）：
>   - `docs/二开日志/2025-10-28-CAS认证接口实现.md`
>   - `docs/二开日志/2025-10-28-前端CAS自动跳转实现.md`
>   - `docs/二开日志/2025-10-29-CAS配置从服务端读取实现.md`
>
> 下面的代码片段（TypeScript、`projects/app/src/pages/api/...` 路径、`fastgpt` 依赖）均**不能**直接套用到 PandaWiki。阅读时请只参考**协议理解层面**的内容（CAS 票据校验流程、XML 响应结构、安全注意事项）。

## 概述

本文档描述了基于 CAS (Central Authentication Service) 的单点登录集成方案，包括前后端实现细节、接口定义和集成指南。

## 目录结构

- [1. 接口定义](#1-接口定义)
- [2. 数据模型](#2-数据模型)
- [3. 后端实现](#3-后端实现)
- [4. 前端实现](#4-前端实现)
- [5. 配置要求](#5-配置要求)
- [6. 依赖项](#6-依赖项)
- [7. 集成步骤](#7-集成步骤)
- [8. 错误处理](#8-错误处理)

---

## 1. 接口定义

### 1.1 主要登录接口

**接口地址**: `POST /api/support/user/account/casLogin`

**请求方式**: POST

**请求头**:

- `Content-Type: application/json`
- `Referer`: 必填，用于验证来源

**请求参数**:

```typescript
interface CasSSOProps {
  service: string;  // CAS 服务地址
  ticket: string;  // CAS 认证票据
}
```

**响应示例**:

```typescript
{
  user: {
    _id: string;
    username: string;
    team: {
      teamId: string;
      tmbId: string;
    };
    // 其他用户信息...
  },
  token: string;  // JWT 认证令牌
}
```

### 1.2 CAS 验证接口

**内部接口**: `/CAS4ICMS/proxyValidate`

**功能**: 验证 CAS 票据并获取用户信息

---

## 2. 数据模型

### 2.1 CAS 响应 XML 结构

CAS 服务返回的标准 XML 格式：

```xml
<cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
    <cas:authenticationSuccess>
        <cas:user>用户ID</cas:user>
        <cas:attributes>
            <cas:loginAccount>登录账号</cas:loginAccount>
            <cas:userName>用户姓名</cas:userName>
            <cas:MblNo>手机号码</cas:MblNo>
            <cas:IdentNo>身份证号</cas:IdentNo>
            <!-- 其他属性... -->
        </cas:attributes>
    </cas:authenticationSuccess>
</cas:serviceResponse>
```

### 2.2 解析后的用户属性

```typescript
interface CASUserAttributes {
  loginAccount: string;    // 登录账号
  userName: string;        // 用户姓名
  MblNo: string;          // 手机号码
  IdentNo: string;        // 身份证号
  InstIdBdy: string;      // 机构ID
  UsrLogonNm: string;     // 用户登录名
  PrsnTp: string;         // 人员类型
  sn: string;             // 序列号
  SysUsrNo: string;       // 系统用户编号
  // 其他属性...
}
```

---

## 3. 后端实现

### 3.1 主要处理流程

```typescript
// projects/app/src/pages/api/support/user/account/casLogin.ts
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const casParams = req.query as CasSSOProps;

  // 1. 参数验证
  if (!casParams || !req.headers.referer) {
    return Promise.reject(CommonErrEnum.invalidParams);
  }

  // 2. CAS 验证
  const { username } = await validate(casParams);

  // 3. 获取用户信息
  const userDetail = await getUserDetail({ username });

  // 4. 创建会话
  const token = await createUserSession({
    userId: userDetail._id,
    teamId: userDetail.team.teamId,
    tmbId: userDetail.team.tmbId,
    isRoot: false,
    ip: requestIp.getClientIp(req)
  });

  // 5. 记录审计日志
  pushTrack.login({
    type: OAuthEnum.cas,
    uid: userDetail._id,
    teamId: userDetail.team.teamId,
    tmbId: userDetail.team.tmbId
  });

  return { user: userDetail, token };
}
```

### 3.2 CAS 票据验证

```typescript
// projects/app/src/service/support/user/account/api.ts
export async function validate(data: CasSSOProps) {
  const res = await GET<string>(
    '/CAS4ICMS/proxyValidate',
    data,
    {},
    global.systemEnv.casHost,
    false
  );

  const parsedInfo = await parseCASResponse(res);
  return {
    username: parsedInfo.attributes.loginAccount,
    realName: parsedInfo.attributes.userName
  };
}
```

### 3.3 XML 解析工具

```typescript
// projects/app/src/service/common/cas/parseCASResponse.ts
export async function parseCASResponse(xml: string) {
  try {
    const result = await parseStringPromise(xml, {
      explicitArray: false,
      tagNameProcessors: [stripPrefix]
    });

    const authSuccess = result['serviceResponse']['authenticationSuccess'];

    if (authSuccess) {
      return {
        user: authSuccess['user'],
        attributes: authSuccess['attributes']
      };
    } else {
      throw new Error('Authentication failed');
    }
  } catch (error) {
    console.error('Error parsing XML: ', error);
    throw error;
  }
}

function stripPrefix(name: string) {
  return name.replace(/^cas:/, '');
}
```

---

## 4. 前端实现

### 4.1 用户状态管理

```typescript
// projects/app/src/web/support/user/useUserStore.ts
interface UserStore {
  initUserInfoByCas: (casParams: CasSSOProps) => Promise<UserType>;
}

// 实现方法
async initUserInfoByCas(casParams: CasSSOProps) {
  const res = await getCasLogin(casParams);
  // 更新用户状态
  return res;
}
```

### 4.2 API 调用

```typescript
// projects/app/src/web/support/user/api.ts
export const getCasLogin = (casParams: CasSSOProps) =>
  GET<LoginSuccessResponse>('/support/user/account/casLogin', { ...casParams }, { maxQuantity: 1 });
```

### 4.3 登录跳转逻辑

```typescript
// projects/app/src/components/Layout/auth.tsx
const handleCasLogin = () => {
  const casHost = feConfigs?.casHost;
  if (casHost) {
    window.location.href = `${casHost}/CAS4ICMS/login?service=${encodeURIComponent(
      window.location.href
    )}`;
  }
};
```

---

## 5. 配置要求

### 5.1 系统环境变量

```typescript
// packages/global/common/system/types/index.d.ts
interface SystemEnvType {
  casHost?: string;  // CAS 服务器地址
}
```

### 5.2 前端配置

```typescript
// 全局配置
const feConfigs = {
  casHost: string;  // CAS 服务地址
};
```

---

## 6. 依赖项

### 6.1 后端依赖

```json
{
  "dependencies": {
    "xml2js": "^0.6.2"
  },
  "devDependencies": {
    "@types/xml2js": "^0.4.14"
  }
}
```

### 6.2 关键导入

```typescript
import { parseStringPromise } from 'xml2js';
import { type CasSSOProps } from '@fastgpt/global/support/user/api';
import { requestIp } from 'request-ip';
```

---

## 7. 集成步骤

### 7.1 后端集成

1. **配置 CAS 服务地址**

   ```typescript
   // 设置全局环境变量
   global.systemEnv.casHost = 'https://your-cas-server.com';
   ```

2. **实现 CAS 验证逻辑**
   - 复制 `validate` 函数到目标项目
   - 根据实际 CAS 服务调整 API 路径

3. **集成 XML 解析**
   - 安装 `xml2js` 依赖
   - 复制 `parseCASResponse` 工具函数

### 7.2 前端集成

1. **添加 API 调用方法**

   ```typescript
   export const getCasLogin = (casParams: CasSSOProps) =>
     POST('/api/cas/login', casParams);
   ```

2. **实现登录跳转**

   ```typescript
   const redirectToCAS = () => {
     const serviceUrl = encodeURIComponent(window.location.href);
     window.location.href = `${casHost}/login?service=${serviceUrl}`;
   };
   ```

3. **处理回调**
   - 在回调页面提取 URL 参数
   - 调用后端登录接口
   - 存储返回的 token

### 7.3 配置步骤

1. **环境变量配置**

   ```bash
   NEXT_PUBLIC_CAS_HOST=https://your-cas-server.com
   ```

2. **CORS 配置**
   确保 CAS 服务器允许你的域名访问

3. **回调 URL 配置**
   在 CAS 服务器注册你的应用回调地址

---

## 8. 错误处理

### 8.1 常见错误类型

```typescript
// 参数错误
if (!casParams) {
  return Promise.reject(CommonErrEnum.invalidParams);
}

// Referer 验证失败
if (!refererHeader) {
  return Promise.reject(CommonErrEnum.invalidParams);
}

// CAS 验证失败
if (!authSuccess) {
  throw new Error('CAS authentication failed');
}
```

### 8.2 异常处理建议

1. **网络超时**: 设置合理的请求超时时间
2. **XML 解析错误**: 捕获并记录详细的解析错误信息
3. **用户不存在**: 提供友好的错误提示和注册引导
4. **会话创建失败**: 记录详细日志，便于排查问题

### 8.3 日志记录

```typescript
// 错误日志
addLog.error(`casParams:${JSON.stringify(casParams)} refererHeader 为空`);

// 审计日志
addAuditLog({
  tmbId: userDetail.team.tmbId,
  teamId: userDetail.team.teamId,
  event: AuditEventEnum.LOGIN
});
```

---

## 9. 安全考虑

### 9.1 安全措施

1. **票据验证**: 严格验证 CAS 票据的有效性
2. **来源检查**: 验证 Referer 头防止 CSRF 攻击
3. **会话管理**: 使用安全的 JWT 令牌机制
4. **IP 记录**: 记录登录 IP 用于安全审计

### 9.2 最佳实践

1. **HTTPS**: 强制使用 HTTPS 传输
2. **令牌过期**: 设置合理的令牌过期时间
3. **错误信息**: 避免在错误信息中泄露敏感信息
4. **日志审计**: 记录所有登录相关的操作日志

---

## 10. 快速开始

### 10.1 最小集成示例

```typescript
// 1. 后端路由
app.post('/api/cas/login', async (req, res) => {
  const { service, ticket } = req.query;

  // 验证 CAS
  const response = await fetch(`${CAS_HOST}/proxyValidate`, {
    params: { service, ticket }
  });

  const xml = await response.text();
  const { attributes } = await parseCASResponse(xml);

  // 查找/创建用户
  const user = await findOrCreateUser(attributes.loginAccount);

  // 创建会话
  const token = createSession(user);

  res.json({ user, token });
});
```

```typescript
// 2. 前端登录按钮
<button onClick={() => {
  const serviceUrl = encodeURIComponent(window.location.href);
  window.location.href = `${CAS_HOST}/login?service=${serviceUrl}`;
}}>
  CAS 登录
</button>
```

```typescript
// 3. 回调处理
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const ticket = params.get('ticket');
  const service = window.location.origin + window.location.pathname;

  if (ticket) {
    loginWithCAS({ service, ticket })
      .then(() => {
        // 登录成功，重定向到主页
        router.push('/dashboard');
      })
      .catch(console.error);
  }
}, []);
```

---

*本文档基于 FastGPT 项目的 CAS 实现整理而成，适用于参考项目进行类似的 CAS 集成开发。*
