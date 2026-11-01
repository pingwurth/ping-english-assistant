---
kind: external_dependency
name: Azure Speech 口语评测（SOE）Provider
slug: azure-speech-services
category: external_dependency
category_hints:
    - vendor_identity
    - auth_protocol
scope:
    - '**'
source_files:
    - server/src/services/soe/index.ts
    - server/src/services/soe/azure.provider.ts
---

### 身份与角色
- 凭据字段：`AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` / `AZURE_SPEECH_HOST`，由 `azureCredsOk` 校验。

### 集成点
- 请求级覆盖：multipart 请求的 `creds.azure.{key,region,host}` 会合并进 env 并现场构造 provider（`resolveSoeProvider`），优先于环境变量。

### 使用约束
- 仅当凭据齐全时才会被注册；缺失凭据时该 provider 不可用，调用方按 503 处理。
- 鉴权协议为 Azure Speech REST API（key + region/host），具体签名细节以 Azure 官方文档为准。