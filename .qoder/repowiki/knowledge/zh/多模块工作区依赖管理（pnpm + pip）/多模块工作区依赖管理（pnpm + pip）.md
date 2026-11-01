---
kind: dependency_management
name: 多模块工作区依赖管理（pnpm + pip）
category: dependency_management
scope:
    - '**'
source_files:
    - client/package.json
    - client/pnpm-lock.yaml
    - server/package.json
    - server/pnpm-lock.yaml
    - server/requirements.txt
    - page-prototype/package.json
    - docs/阿里云翻译SDK示例/package.json
    - client/.mimocode/package.json
---

## 1. 使用的系统/工具

仓库是一个多模块 Node.js + Python 聚合项目，依赖管理按模块独立进行：
- **Node.js 模块**（`client/`、`server/`、`page-prototype/`、`docs/阿里云翻译SDK示例/`、`client/.mimocode/`）统一使用 **pnpm** 作为包管理器，通过 `package.json` 声明依赖，并通过 `pnpm-lock.yaml` / `package-lock.json` 锁定版本。
- **Python 模块**（`server/requirements.txt`）使用 **pip**，以 `requirements.txt` 形式声明依赖，未使用 `pyproject.toml` / `Pipfile` / `poetry`。

## 2. 关键文件

- `client/package.json` + `client/pnpm-lock.yaml` — 前端 Next.js 应用的主依赖清单与锁文件。
- `server/package.json` + `server/pnpm-lock.yaml` — Fastify 后端服务的依赖清单与锁文件。
- `server/requirements.txt` — Python 侧依赖（whisperx、torch、fastapi、uvicorn、faster-whisper 等）。
- `page-prototype/package.json` + `page-prototype/pnpm-lock.yaml` — 原型页面的依赖。
- `docs/阿里云翻译SDK示例/package.json` + `docs/阿里云翻译SDK示例/package-lock.json` — 独立的阿里云翻译 SDK 参考实现。
- `client/.mimocode/package.json` + `client/.mimocode/package-lock.json` — 内部插件 `@mimo-ai/plugin` 的独立子项目。
- `.claude/skills/shadcn/SKILL.md` — 约定 shadcn CLI 应通过项目的 `packageManager` 对应的 runner（`pnpm dlx` / `npx` / `bunx --bun`）调用。

## 3. 架构与约定

### 3.1 pnpm 配置（client 与 server 一致）
- 依赖版本采用语义化范围（如 `^4.0.47`、`^19`、`>=20`），而非绝对版本号。
- `client/package.json` 中通过 `pnpm.overrides` 强制将传递依赖 `hono` 固定到 `4.12.25`，用于解决版本冲突。
- `client/package.json` 中通过 `pnpm.onlyBuiltDependencies` 仅构建 `msw`、`onnxruntime-node`、`protobufjs`、`sharp` 四个原生依赖；通过 `pnpm.ignoredBuiltDependencies` 跳过 `msw`、`protobufjs` 的原生构建，加速安装。
- `server/package.json` 通过 `engines.node = ">=20"` 声明运行时要求。

### 3.2 Python 依赖
- `server/requirements.txt` 使用 `>=` 宽松下限（如 `whisperx>=3.3.0`、`torch>=2.0.0`、`fastapi>=0.115.0`），没有精确上限，也没有生成 `requirements.txt.lock`。

### 3.3 多模块隔离
- 每个 Node 子项目各自维护独立的 `package.json` 和锁文件，不存在根级 `package.json` 或 workspace 配置。
- `client/.mimocode/` 是独立的 npm 子项目，只依赖 `@mimo-ai/plugin@0.1.13`，并使用自己的 `package-lock.json`。
- `docs/阿里云翻译SDK示例/` 是独立的参考实现，使用 `package-lock.json`（非 pnpm），且其 TypeScript 版本（`^3.7.5`）明显落后于主项目（`5.7.3`），说明它不随主工程升级。

### 3.4 包来源
- 未发现私有 registry 配置（无 `.npmrc` / `.pnpmrc` / `PIP_INDEX_URL` 等）。所有依赖来自公共 npm registry 与 PyPI。
- 未发现 vendored（内联复制）第三方源码目录，依赖全部通过包管理器安装到各模块的 `node_modules/`。

## 4. 约定与约束

- **pnpm 为默认 Node 包管理器**：`.claude/skills/shadcn/SKILL.md` 明确要求 shadcn CLI 必须通过项目的 `packageManager` 对应的 runner 执行（`pnpm dlx` / `npx` / `bunx --bun`），禁止直接调用全局安装的 shadcn。
- **shadcn 组件安装前需检查 `package.json`**：`.claude/skills/design-system/SKILL.md` 规定在引入任何第三方库前必须先检查 `package.json`，缺失则先输出安装命令，不得假设库已存在。
- **Node 版本约束**：`server/package.json` 通过 `engines.node >= 20` 强制最低 Node 版本；`client/pnpm-lock.yaml` 中部分依赖声明 `engines.node >= 22`，表明客户端依赖链对 Node 版本有更高要求。
- **传递依赖强制覆盖**：`client/package.json` 的 `pnpm.overrides.hono = "4.12.25"` 对所有子树生效，确保 hono 版本一致性。
- **原生依赖最小化构建**：`client/package.json` 的 `onlyBuiltDependencies` 与 `ignoredBuiltDependencies` 显式限定原生模块构建范围，避免无关 C++ 扩展编译。
- **Python 依赖使用宽松下限**：`server/requirements.txt` 全部使用 `>=` 形式，未锁定精确版本，也未提供可复现的 lock 文件。
- **子项目独立演进**：`docs/阿里云翻译SDK示例/` 与主工程完全解耦，拥有独立的依赖集与过时的工具链（TypeScript 3.7、Mocha、ts-node 8），仅作为文档参考代码保留。