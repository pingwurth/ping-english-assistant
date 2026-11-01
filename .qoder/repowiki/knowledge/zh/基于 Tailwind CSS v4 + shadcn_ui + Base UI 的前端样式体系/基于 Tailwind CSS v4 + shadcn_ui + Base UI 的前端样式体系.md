---
kind: frontend_style
name: 基于 Tailwind CSS v4 + shadcn/ui + Base UI 的前端样式体系
category: frontend_style
scope:
    - '**'
source_files:
    - client/app/globals.css
    - client/components.json
    - client/postcss.config.mjs
    - client/package.json
    - client/lib/utils.ts
    - client/components/ui/button.tsx
---

## 1. 使用的系统与工具链

- **CSS 框架**: Tailwind CSS v4（`tailwindcss@^4.3.3`），通过 `@import 'tailwindcss'` 在 `client/app/globals.css` 中引入，PostCSS 插件为 `@tailwindcss/postcss`。
- **组件库**: shadcn/ui（`shadcn@^4.8.0`）作为脚手架与基础组件来源，同时底层交互原语来自 `@base-ui/react`（如 Button、Dialog、Sheet、Tabs 等）。shadcn 配置位于 `client/components.json`，style 设为 `base-nova`，启用 RSC、TSX、CSS Variables、`baseColor: neutral`，图标库为 `lucide-react`。
- **动画库**: `tw-animate-css`（`@import 'tw-animate-css'`）提供预置动画类，并在 `globals.css` 中额外定义了项目自定义动画：`.ping-highlight-flash`、`.animate-shake`、`.animate-hint-glow`。
- **样式组合工具**: `clsx` + `tailwind-merge`，封装为 `cn()`（`client/lib/utils.ts`），用于合并 className；`class-variance-authority`（`cva`）用于定义组件变体。

## 2. 关键文件

- `client/app/globals.css` — 全局主题变量、暗色模式、Tailwind/shadcn/tw-animate-css 的入口。
- `client/components.json` — shadcn/ui 配置（路径别名、Tailwind 集成、baseColor、iconLibrary）。
- `client/postcss.config.mjs` — PostCSS 仅挂载 `@tailwindcss/postcss`。
- `client/package.json` — 声明 tailwindcss、@tailwindcss/postcss、tw-animate-css、shadcn、@base-ui/react、clsx、tailwind-merge、class-variance-authority、lucide-react 等依赖。
- `client/lib/utils.ts` — `cn()` 工具函数。
- `client/components/ui/*.tsx` — shadcn 生成的原子 UI 组件（button、badge、card、dialog、input、progress、separator、sheet、switch、tabs、textarea）。

## 3. 架构与设计约定

### 3.1 设计令牌（Design Tokens）

所有视觉变量以 CSS Custom Properties 形式集中在 `:root` 和 `.dark` 选择器下，使用 OKLCH 色彩空间（如 `--background: oklch(1 0 0)`、`--primary: oklch(0.205 0 0)`）。`@theme inline` 块将 shadcn 的语义化 token（`--color-primary`、`--color-card`、`--color-muted`、`--radius-*`、`--chart-*`、sidebar 系列等）映射到 Tailwind 可识别的 `--color-*` 命名空间。半径通过 `--radius` 派生出一组 `--radius-sm/md/lg/xl/2xl/3xl/4xl`。

暗色模式通过三种方式生效：
1. 显式 `.dark` 类（由 shadcn 的 dark mode 策略驱动）。
2. `@custom-variant dark (&:is(.dark *))` 注册 Tailwind 自定义变体。
3. `@media (prefers-color-scheme: dark)` 自动跟随系统偏好。

### 3.2 组件样式组织

- 原子级 UI 组件位于 `client/components/ui/`，每个组件独立文件，遵循 shadcn 生成模板。
- 业务页面组件位于 `client/components/pages/`，共享通用逻辑组件位于 `client/components/shared/`。
- 组件样式采用 **CVA 变体 + Tailwind 原子类** 的组合：用 `cva()` 声明 `variant`/`size` 等变体，再通过 `cn(buttonVariants({ variant, size, className }))` 合并用户传入的 className。
- 所有 className 合并统一走 `cn()`，确保 `tailwind-merge` 能正确去重与覆盖冲突类。

### 3.3 响应式与布局

- 未使用传统媒体查询进行断点控制，而是依赖 Tailwind 的响应式前缀（如 `sm:`、`md:`、`lg:`）。
- 无独立的 `tailwind.config.js`（`components.json` 中 `"config": ""`），全部样式能力通过 Tailwind v4 的 CSS 原生特性（`@theme`、`@layer`、`@apply`）实现。

### 3.4 动画与微交互

- 通用动画通过 `tw-animate-css` 引入。
- 业务特定动画在 `globals.css` 中以 `@keyframes` 定义并暴露为 class（如 `.ping-highlight-flash` 用于设置页输入框高亮闪烁，`.animate-shake` 用于九宫格选错抖动，`.animate-hint-glow` 用于提示高亮）。

## 4. 约定与约束

- **颜色必须使用 CSS 变量**：所有颜色值通过 `--color-*` / `--foreground` / `--background` 等语义化变量引用，禁止在组件中硬编码十六进制或 RGB 值。
- **className 合并必须走 `cn()`**：组件 props 上的 className 一律经 `cn(...)` 处理，保证与 Tailwind 原子类的优先级可控。
- **组件变体使用 `cva`**：UI 组件的变体（variant、size 等）通过 `class-variance-authority` 声明，而非散落的条件渲染类名。
- **暗色模式通过 `.dark` 类或系统偏好**：新增主题色需同时在 `:root` 与 `.dark` 下定义对应的 CSS 变量。
- **Tailwind v4 语法**：使用 `@import 'tailwindcss'` 替代旧的 `@tailwind base/components/utilities`，并通过 `@theme inline` 注入设计令牌。
- **shadcn 组件通过 CLI 管理**：新增 UI 组件应通过 `shadcn add` 命令生成，以保持 `components.json` 中的别名与模板一致。
- **图标统一使用 lucide-react**：由 `components.json` 中 `iconLibrary: "lucide"` 指定，避免混入其他图标库。