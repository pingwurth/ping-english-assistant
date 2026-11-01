---
kind: logging_system
name: 日志系统：Fastify 内置 logger + 前端 console.* 直出，无统一框架
category: logging_system
scope:
    - '**'
source_files:
    - server/src/app.ts
    - server/src/index.ts
    - client/app/api/mnemonic/route.ts
    - client/app/api/transcribe/route.ts
    - client/app/api/translate/route.ts
    - client/app/api/tts/route.ts
    - client/app/api/models/route.ts
    - client/app/api/transcribe/local/route.ts
    - client/components/shared/vocab-book-picker.tsx
    - .claude/skills/code-review-p/scripts/crp/logutil.py
---

## 1. 使用的系统与工具

仓库没有引入第三方日志库（如 pino、winston、bunyan、morgan）。日志输出由两部分组成：

- **后端（server/）**：使用 Fastify 内置的 `logger`（默认基于 pino），通过 `Fastify({ logger: ... })` 启用。
- **前端（client/）**：直接使用浏览器/Node 原生的 `console.log / console.warn / console.error / console.debug`，未封装任何 logger 模块。
- **Python 脚本（仅 .claude/skills/code-review-p/scripts/crp/logutil.py）**：使用 Python 标准库 `logging`，为 Claude Code Review 辅助脚本提供文件日志能力，不属于应用主代码。

## 2. 关键文件

- `server/src/app.ts` — Fastify 实例装配，集中开启内置 logger 与全局错误处理器。
- `server/src/index.ts` — 进程入口，在 SIGINT/SIGTERM 中调用 `app.log.info` 记录优雅关闭。
- `client/app/api/mnemonic/route.ts`、`client/app/api/transcribe/route.ts`、`client/app/api/translate/route.ts`、`client/app/api/tts/route.ts`、`client/app/api/models/route.ts`、`client/app/api/transcribe/local/route.ts` — BFF API Route 中使用 `console.log/warn/error` 打印请求参数、供应商信息、错误堆栈等。
- `client/components/shared/vocab-book-picker.tsx` — 组件层唯一的 `console.error` 调用。
- `.claude/skills/code-review-p/scripts/crp/logutil.py` — Python 侧独立日志工具（非应用主体）。

## 3. 架构与约定

### 后端（Fastify）

- `buildApp(env, opts?)` 在 `server/src/app.ts` 中以 `Fastify({ logger: opts?.logger ?? true, bodyLimit: 32 * 1024 * 1024 })` 创建实例，**默认启用内置 logger**；测试可通过传入 `{ logger: false }` 禁用。
- 所有 HTTP 访问日志、结构化请求上下文由 Fastify 内置 logger 自动产出（pino 格式）。
- 业务异常通过 `req.log.error(err)` 在统一错误处理器中记录（`server/src/app.ts:33`），随后返回统一的 `{ code, message, detail? }` JSON 响应。
- 进程信号处理在 `server/src/index.ts:15` 中通过 `app.log.info({ signal: sig }, 'shutting down')` 记录退出原因，附带结构化字段 `signal`。
- 路由层本身不直接调用 `req.log`，而是依赖 Fastify 的错误处理器和内置访问日志。

### 前端（Next.js App Router BFF + SPA）

- 所有服务端路由（`client/app/api/*`）均使用原生 `console.log / console.warn / console.error`，没有统一的 logger 模块或日志级别配置。
- 日志前缀采用 `[模块名]` 形式（如 `[Mnemonic]`、`[Transcribe]`、`[Translate]`、`[TTS]`、`[VocabBookPicker]`），便于在控制台区分来源。
- 错误路径统一使用 `console.error`，并附带结构化对象（如 `{ error.code, error.message }`）。
- 客户端组件层（`client/core/**`、`client/components/**`）几乎不使用日志，仅在 `vocab-book-picker.tsx` 一处捕获并输出错误。

### Python 辅助脚本

`.claude/skills/code-review-p/scripts/crp/logutil.py` 提供 `setup_logger(script_name, run_dir)` 与 `module_logger()`，基于 Python `logging` 模块，将每个子命令的日志写入独立文件（以 `run_dir` 命名），并使用 `config.LOG_FORMAT` / `config.LOG_DATE_FORMAT` 格式化。该模块与主应用无关，仅供 Claude Code Review 技能脚本使用。

## 4. 约定与约束

- **后端日志级别**：由 Fastify 内置 logger 控制，应用代码不显式设置级别；业务错误统一走 `req.log.error`。
- **前端无日志框架**：BFF API Route 与 UI 组件全部使用 `console.*`，不存在日志级别、采样、过滤或 sink 配置。
- **结构化字段**：后端通过 Fastify 的 pino 原生结构化能力（如 `app.log.info({ signal: sig }, ...)`）输出 JSON 字段；前端 `console.error` 也常以对象字面量传递多个字段（如 `{ error.code, error.message }`），但未经序列化器统一处理。
- **错误出口统一**：后端通过 `setErrorHandler` 将所有异常归一化为 `{ code, message, detail? }` 响应，同时用 `req.log.error` 记录原始错误对象。
- **优雅关闭可观测性**：进程收到 `SIGINT` / `SIGTERM` 时，先 `app.log.info` 再 `app.close()`，确保关闭过程可被追踪。
- **Python 脚本日志隔离**：`logutil.py` 中 `logger.propagate = False`，禁止传播到根 logger，保证 stdout 仅用于 NEXT_STEP 协议块，日志单独落盘。

总结：该项目是一个“轻量级”日志方案——后端依赖 Fastify/pino 内置 logger，前端完全裸用 `console.*`，没有跨模块的统一 logger 抽象、日志级别策略或远程 sink。