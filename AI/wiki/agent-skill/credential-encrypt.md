# access_credential 加密算法

调用方需要在本地把最终用户的 `notes_id`（工号）加密成 `access_credential`，随接口请求体一起发送。

## 算法规格（必须严格一致）

| 项 | 值 |
|-----|-----|
| 算法 | AES-256-GCM |
| 密钥（key）| 32 字节，来自 `secret` 的 hex 解码（`secret` 本身是 64 位 hex 字符串）|
| 随机数（nonce / IV）| 12 字节，每次加密独立随机生成 |
| 附加数据（AAD）| 无（空）|
| 认证标签（auth tag）| 16 字节（GCM 默认）|
| 密文布局 | `nonce (12B) ‖ ciphertext ‖ tag (16B)` 拼接后整体 Base64 **标准**编码（非 URL-safe）|
| 明文 | `notes_id` 的 UTF-8 字节 |

**关键点**：
1. 每次加密的 nonce **必须独立随机**，不能固定，否则 GCM 安全性失效
2. 使用 Base64 **StdEncoding**（`+` / `/` 字符），不是 URL-safe 的 `-` / `_`
3. `secret` 是 64 字符 hex 字符串 —— 使用前要先 **hex decode 成 32 字节**

## 参考实现（四种语言）

> 下面代码片段均经过和后端（`backend/pkg/crypto/aes.go`）对照验证，可直接复制到调用方服务使用。

### Python 3.8+

依赖：`cryptography`（`pip install cryptography`）

```python
import os
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def encrypt_access_credential(secret_hex: str, notes_id: str) -> str:
    """
    用 secret 加密 notes_id 得到 access_credential。
    secret_hex: PandaWiki 管理员签发的 64 位 hex 字符串
    notes_id:   最终用户工号
    """
    key = bytes.fromhex(secret_hex)
    if len(key) != 32:
        raise ValueError("secret must decode to 32 bytes")
    nonce = os.urandom(12)
    aesgcm = AESGCM(key)
    ciphertext_with_tag = aesgcm.encrypt(nonce, notes_id.encode("utf-8"), None)
    return base64.b64encode(nonce + ciphertext_with_tag).decode("ascii")
```

### Node.js 16+

依赖：Node.js 内置 `crypto`（无需额外包）

```javascript
const crypto = require('crypto');

/**
 * @param {string} secretHex PandaWiki 管理员签发的 64 位 hex 字符串
 * @param {string} notesId   最终用户工号
 * @returns {string}         access_credential（Base64）
 */
function encryptAccessCredential(secretHex, notesId) {
  const key = Buffer.from(secretHex, 'hex');
  if (key.length !== 32) throw new Error('secret must decode to 32 bytes');
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(notesId, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]).toString('base64');
}
```

### 浏览器 JS（Web Crypto API）

> ⚠️ **强烈不推荐**在浏览器里加密 —— 这要求 `secret` 下发到前端，等同于把长期密钥暴露给用户，任何人打开 DevTools 就能拿到。本片段仅用于**一次性内部演示 / 脚手架页**，生产环境一律在后端加密。

```javascript
async function encryptAccessCredential(secretHex, notesId) {
  // hex → Uint8Array
  const keyBytes = new Uint8Array(
    secretHex.match(/.{2}/g).map(b => parseInt(b, 16))
  );
  if (keyBytes.length !== 32) throw new Error('secret must decode to 32 bytes');

  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextWithTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      new TextEncoder().encode(notesId),
    )
  );

  // nonce ‖ ciphertext+tag
  const out = new Uint8Array(nonce.length + ciphertextWithTag.length);
  out.set(nonce, 0);
  out.set(ciphertextWithTag, nonce.length);

  // Uint8Array → Base64 (StdEncoding)
  let bin = '';
  for (const b of out) bin += String.fromCharCode(b);
  return btoa(bin);
}
```

### Go 1.20+

```go
package main

import (
    "crypto/aes"
    "crypto/cipher"
    "crypto/rand"
    "encoding/base64"
    "encoding/hex"
    "fmt"
    "io"
)

// EncryptAccessCredential 用 secret 加密 notes_id 得到 access_credential。
// secretHex: PandaWiki 管理员签发的 64 位 hex 字符串
// notesID:   最终用户工号
func EncryptAccessCredential(secretHex, notesID string) (string, error) {
    key, err := hex.DecodeString(secretHex)
    if err != nil {
        return "", err
    }
    if len(key) != 32 {
        return "", fmt.Errorf("secret must decode to 32 bytes, got %d", len(key))
    }

    block, err := aes.NewCipher(key)
    if err != nil {
        return "", err
    }
    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return "", err
    }

    nonce := make([]byte, gcm.NonceSize())
    if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
        return "", err
    }

    // gcm.Seal 返回 nonce ‖ ciphertext ‖ tag
    sealed := gcm.Seal(nonce, nonce, []byte(notesID), nil)
    return base64.StdEncoding.EncodeToString(sealed), nil
}
```

## 自检用例

用同一对 `(secret, notes_id)` 多次调用加密，每次结果应当**不同**（nonce 随机），但都能被 PandaWiki 正确解密。

快速连通性测试：

```bash
# 1. 用上面任一实现加密 notes_id
#    例：secret="abcd...64位", notes_id="015032"
#    → access_credential="xxxxx..."

# 2. 调 /api/v1/kb/list 验证
curl -X POST http://<base_url>/api/v1/kb/list \
  -H "Authorization: Bearer <system_api_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "system_id": "test",
    "access_credential": "<第 1 步生成的密文>"
  }'
```

- 返回 `"success": true` → 加密实现正确
- 返回 `code: 40001` + `"解密失败"` → 通常是 secret 配错 / Base64 编码错（URL-safe vs std）/ nonce 长度错
- 返回 `code: 40003` + `"用户不存在"` → 加密对了但 notes_id 没同步到 PandaWiki 用户表

## 常见坑

1. **用 URL-safe Base64 编码** → 后端用 `StdEncoding` 解，碰到 `-` / `_` 会解失败。永远用标准 `+` / `/`。
2. **nonce 写死成固定值** → 加密成功但**安全性失效**，必须每次随机。
3. **把密钥当 UTF-8 字节用** → 你用的是 64 字符 hex，必须 hex decode 成 32 字节，而不是 `secret.getBytes()`。
4. **把 tag 附加数据（AAD）填了东西** → 后端 AAD 为空，调用方也必须空。

## 变更历史

- 2026-04-22: 初始化加密算法说明（Python / Node / Browser JS / Go 四份参考）
