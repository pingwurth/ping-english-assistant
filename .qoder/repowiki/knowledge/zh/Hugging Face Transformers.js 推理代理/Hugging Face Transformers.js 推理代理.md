---
kind: external_dependency
name: Hugging Face Transformers.js 推理代理
slug: huggingface-transformers
category: external_dependency
category_hints:
    - vendor_identity
    - framework_behavior
scope:
    - '**'
source_files:
    - client/app/api/hf/[...path]/route.ts
    - client/package.json
---

### 身份与角色
- 前端通过 `@huggingface/transformers` 在浏览器端运行轻量模型推理，并通过 Next.js Route Handler `/api/hf/[...path]` 做反向代理。

### 集成点
- 代理路由：`client/app/api/hf/[...path]/route.ts` 将 HF Hub 上的模型权重/配置请求转发到 Hugging Face CDN。

### 行为约束
- 这是一个浏览器端推理运行时，不是服务端模型服务；模型下载受网络与缓存策略影响，部署时需确认 CDN 可达性。