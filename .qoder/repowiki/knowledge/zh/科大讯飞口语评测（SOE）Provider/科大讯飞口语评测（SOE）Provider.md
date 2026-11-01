---
kind: external_dependency
name: 科大讯飞口语评测（SOE）Provider
slug: iflytek
category: external_dependency
category_hints:
    - vendor_identity
    - auth_protocol
scope:
    - '**'
source_files:
    - server/src/services/soe/index.ts
    - server/src/services/soe/iflytek.provider.ts
    - server/src/services/soe/iflytek-auth.ts
    - server/src/services/soe/iflytek-xml.ts
---

### 身份与角色
- 凭据字段：`IFLYTEK_APP_ID` / `IFLYTEK_API_KEY` / `IFLYTEK_API_SECRET`，由 `iflytekCredsOk` 校验。

### 集成点
- 请求级覆盖：multipart 请求的 `creds.iflytek.{appId,apiKey,apiSecret}` 会合并进 env 并现场构造 provider。
- 独立子模块：`iflytek-auth.ts`（鉴权）、`iflytek-xml.ts`（XML 解析）、`iflytek.provider.ts`（WS 流式 ISE）。