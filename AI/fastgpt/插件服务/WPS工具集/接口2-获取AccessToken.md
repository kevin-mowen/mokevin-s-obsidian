# 接口2：获取 WPS Access Token

## 基本信息

| 项目 | 说明 |
|------|------|
| 用途 | 使用 SM2 加密后的密文换取 WPS 用户的 access_token，用于后续 OpenAPI 调用鉴权 |
| 地址 | `https://weboffice.cib.com.cn/c/ciblogin/api/v1/getUserInfoForAIOp` |
| 方法 | POST |
| Content-Type | application/json |
| 所属步骤 | 步骤 3.2（WPS 用户认证 - 获取令牌阶段） |
| 调用方式 | 使用项目封装的 `POST` 函数（基于 fetch） |

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| data | string | 是 | [[接口1-SM2加密]] 返回的 ciphertext 密文 |

## 请求示例

```json
{
  "data": "04a1b2c3d4e5f6..."
}
```

## 响应参数

响应为嵌套结构：

| 路径 | 类型 | 说明 |
|------|------|------|
| data | object | 顶层数据对象 |
| data.token | object | 令牌对象 |
| data.token.access_token | string | WPS 用户的 Bearer 令牌 |

## 响应示例

```json
{
  "data": {
    "token": {
      "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6..."
    }
  }
}
```

## 错误处理

- 当 `data.data.token.access_token` 不存在时，抛出异常：`getUserInfoForAIOp 接口未返回 data.token.access_token: <完整响应体>`

## 注意事项

- 该接口域名 `weboffice.cib.com.cn` 为行内定制 WPS 服务，非公网 WPS
- 返回的 access_token 在后续接口 3、接口 4 中**共用**，以 `Bearer <token>` 形式放入 Authorization 请求头
- access_token 未做缓存，每次调用均重新获取
- 该接口可能返回用户的其他信息，但本工具只使用 access_token

## 上下游关系

- 上游输入：[[接口1-SM2加密]] 返回的 ciphertext
- 下游消费：[[接口3-获取分享文件详情]] 和 [[接口4-获取下载链接]] 共用返回的 access_token
