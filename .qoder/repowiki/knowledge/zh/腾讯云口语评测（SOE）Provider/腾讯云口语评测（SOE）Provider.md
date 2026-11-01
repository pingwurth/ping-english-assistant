---
kind: external_dependency
name: 腾讯云口语评测（SOE）Provider
slug: tencent-cloud-speech
category: external_dependency
category_hints:
    - vendor_identity
    - auth_protocol
scope:
    - '**'
source_files:
    - server/src/services/soe/index.ts
    - server/src/services/soe/tencent.provider.ts
    - server/src/services/soe/tencent-ws-auth.ts
---

### 身份与角色
- 凭据字段：`TENCENT_APP_ID` / `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`，由 `tencentCredsOk` 校验。

### 集成点
- 请求级覆盖：multipart 请求的 `creds.tencent.{appId,secretId,secretKey}` 会合并进 env 并现场构造 provider。

### 使用约束
- 鉴权走腾讯云 V3 SDK 签名（AppId + SecretId + SecretKey），具体签名细节以腾讯云官方文档为准。
- 当前实现已落地（非占位），详见 `tencent.provider.ts` 与 `tencent-ws-auth.ts`。