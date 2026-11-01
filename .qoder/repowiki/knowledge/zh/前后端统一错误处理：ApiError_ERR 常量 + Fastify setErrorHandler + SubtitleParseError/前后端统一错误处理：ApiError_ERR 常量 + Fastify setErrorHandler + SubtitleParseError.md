---
kind: error_handling
name: 前后端统一错误处理：ApiError/ERR 常量 + Fastify setErrorHandler + SubtitleParseError
category: error_handling
scope:
    - '**'
source_files:
    - server/src/lib/api-error.ts
    - server/src/app.ts
    - server/src/routes/soe.route.ts
    - server/src/services/soe/azure.provider.ts
    - client/core/subtitle/errors.ts
    - client/core/subtitle/index.ts
    - client/core/subtitle/srt.ts
    - client/core/subtitle/lrc.ts
---

## 1. 总体方案

仓库采用**前后端各自定义领域错误类型 + 服务端集中映射 HTTP 语义**的方式，没有引入第三方错误库（如 `zod`、`class-transformer`）。

- **后端（Fastify）**：在 `server/src/lib/api-error.ts` 定义 `ApiError` 类与 `ERR` 常量表，通过 `app.setErrorHandler` 把异常统一序列化为 `{ code, message, detail? }` JSON。
- **前端（Next.js App Router）**：各 API route 使用 `try/catch` 包裹业务调用，捕获后返回 Next `Response`；字幕解析等纯客户端逻辑抛出 `SubtitleParseError` 供 UI 就地提示。
- **无 panic/recover**：TypeScript 项目未出现 `throw new Error(...)` 之外的全局 panic 模式，也没有 `try/catch` 包裹的 recover 逻辑。

## 2. 关键文件

| 路径 | 职责 |
|---|---|
| `server/src/lib/api-error.ts` | `ApiError` 类、`ERR` 错误码常量、`apiError()` 工厂 |
| `server/src/app.ts` | Fastify 实例装配 + 全局 `setErrorHandler` |
| `server/src/routes/soe.route.ts` | SOE 路由参数校验，全部通过 `throw apiError(ERR.X, ...)` 表达业务错误 |
| `server/src/services/soe/*.provider.ts` | 上游供应商调用失败时抛 `ApiError`（超时、未配置密钥、429/502 等） |
| `client/core/subtitle/errors.ts` | `SubtitleParseError extends Error`，携带 `line` 行号 |
| `client/core/subtitle/index.ts` / `lrc.ts` / `srt.ts` | 解析入口与各格式解析器统一抛 `SubtitleParseError` |

## 3. 架构与约定

### 3.1 后端 `ApiError` 与 `ERR`

```ts
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 500,
    readonly detail?: unknown,
  ) { ... }
}
```

`ERR` 是 `as const` 对象，维护错误码到 HTTP 状态的固定映射：

- `BAD_REQUEST` → 400
- `PAYLOAD_TOO_LARGE` → 413
- `SOE_NO_SPEECH` → 400
- `UPSTREAM_RATE_LIMIT` → 429
- `UPSTREAM_TIMEOUT` → 504
- `SOE_UPSTREAM_ERROR` → 502
- `PROVIDER_UNAVAILABLE` → 503
- `INTERNAL` → 500

所有业务抛错都走 `apiError(ERR.X, message, detail?)` 工厂，避免手写状态码。

### 3.2 Fastify 全局错误处理器

`server/src/app.ts` 中注册了唯一的 `app.setErrorHandler`，按以下优先级处理：

1. `err instanceof ApiError` → 直接以 `err.httpStatus` 返回 `{ code, message, detail }`。
2. 非 `ApiError` 但 `statusCode ∈ [400, 500)` → 保留原状态码，413 映射为 `PAYLOAD_TOO_LARGE`，其余映射为 `BAD_REQUEST`，只返回 `{ code, message }`（不暴露原始 message）。
3. 其他 → 记录 `req.log.error(err)`，返回 500 + `{ code: 'INTERNAL', message: '服务器内部错误' }`。

注释明确说明该设计对齐架构文档 §3.3 的错误格式。

### 3.3 前端字幕解析错误

`SubtitleParseError` 继承 `Error`，构造签名 `(message, line = 0)`，`line` 为 1 基的行号。SRT/LRC 解析器在遇到非法时间戳、空内容、无法识别格式时抛出该错误，测试用例断言 `toThrowError(SubtitleParseError)` 并检查 `.line` 字段，确保“带行号的容错”策略落地。

### 3.4 前端 Next API Route

Next.js 的 `app/api/*` 路由普遍使用 `try/catch` 包裹下游调用，例如 `client/app/api/hf/[...path]/route.ts`、`client/app/api/mnemonic/route.ts`、`client/app/api/settings/*/route.ts` 等，捕获网络或解析异常后返回结构化响应。部分 `fetch` 调用链还使用 `.catch(() => '')` / `.catch(() => null)` 对可忽略的读取失败做降级。

## 4. 观察到的约定与约束

- **后端业务错误一律通过 `throw apiError(ERR.X, ...)` 抛出**，而非裸 `throw new Error(...)`。证据：`server/src/routes/soe.route.ts` 中所有参数校验分支均使用该工厂。
- **HTTP 状态码由 `ERR` 常量表集中声明**，业务代码不硬编码数字。`ApiError` 构造函数默认 `httpStatus = 500`，强制显式指定业务状态。
- **Fastify 全局 `setErrorHandler` 是唯一错误出口**，注释写明“统一错误出口：ApiError → 自带状态码；multipart 的 413/400 保留状态、补齐 code；其余归一 500”。
- **非 `ApiError` 的 4xx 错误会被重映射为 `BAD_REQUEST` 或 `PAYLOAD_TOO_LARGE`**，防止上游框架泄露原始错误信息。
- **5xx 非预期异常统一返回 `INTERNAL` + 中文消息 `'服务器内部错误'`**，原始堆栈仅写入日志，不随响应体返回。
- **字幕解析错误统一抛 `SubtitleParseError` 且携带 `line` 行号**，测试覆盖“无法定位时为 0”和具体行号两种情况。
- **前端 API route 使用 try/catch 包裹异步调用**，未发现统一的中间件层；每个 route 自行决定如何包装响应。

## 5. 局限

- 前端没有与服务端同构的 `ApiError` 类型（注释提到“与前端 services/contracts.ts 的 ApiError 对齐”，但该文件在当前工作区树中未出现），前端 API 调用方需自行判断响应结构。
- 错误传播依赖手动 `try/catch`，没有全局拦截器或 Promise unhandled rejection 处理器。
- 错误码目前仅服务于 SOE 评分接口，尚未扩展到其他后端路由。