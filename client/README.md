# 英语精听助手 · Client

面向英语精听、听写与跟读训练的本地优先学习工具前端应用。

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js | 16.3.0 |
| UI 库 | React | 19 |
| 语言 | TypeScript | 5.7.3 |
| 路由 | React Router DOM | 7.18.2 |
| 样式 | Tailwind CSS | 4.3.3 |
| 组件库 | shadcn/ui (base-nova) | 4.8.0 |
| 图标 | Lucide React | 1.16.0 |
| 状态管理 | useSyncExternalStore (自研轻量 store) | - |
| 本地存储 | IndexedDB (idb) | - |
| 测试 | Vitest | 4.1.11 |
| 包管理 | pnpm | - |

## 目录结构

```
client/
├── app/                    # Next.js App Router
│   ├── globals.css         # 全局样式 + Tailwind 配置
│   ├── layout.tsx          # 根布局（元数据、字体、Analytics）
│   └── page.tsx            # 入口页（挂载 StudyApp SPA）
├── components/
│   ├── pages/              # 页面组件（P0-P11）
│   │   ├── library.tsx     # P0 材料库
│   │   ├── import.tsx      # P1 导入材料
│   │   ├── player.tsx      # P2 精听播放器
│   │   ├── training-center.tsx  # P3 训练中心
│   │   ├── puzzle.tsx      # P4 九宫格（选词拼句）
│   │   ├── dictation.tsx   # P5 单句听写
│   │   ├── transcribe.tsx  # P6 录音转写
│   │   ├── training/
│   │   │   ├── shadowing.tsx   # P7 影子跟读
│   │   │   ├── recitation.tsx  # P8 全文背诵
│   │   │   └── read-aloud.tsx  # P8.5 朗读评分
│   │   ├── report.tsx      # P9 分析报告
│   │   ├── settings.tsx    # P10 设置
│   │   ├── tts.tsx         # P11 文字转语音
│   │   └── placeholder.tsx # 占位页（404 等）
│   ├── shared/             # 共享业务组件
│   │   ├── shell.tsx       # 页面外壳布局
│   │   ├── player-parts.tsx    # 播放器子组件
│   │   ├── record-button.tsx   # 录音按钮（声波动画）
│   │   ├── score-panel.tsx     # 评分面板
│   │   └── training-session-shell.tsx  # 训练会话外壳
│   ├── ui/                 # shadcn/ui 基础组件
│   │   ├── badge.tsx
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── input.tsx
│   │   ├── progress.tsx
│   │   ├── separator.tsx
│   │   └── textarea.tsx
│   └── study-app.tsx       # SPA 入口（BrowserRouter + Routes）
├── core/                   # 平台无关纯 TS 逻辑
│   ├── audio/              # 音频处理（WAV 编码器）
│   ├── player/             # 播放器抽象层（SentencePlayer）
│   └── subtitle/           # SRT/LRC 字幕解析器
├── data/
│   └── seed.ts             # 种子数据（4 条示例材料 + 5 句字幕）
├── lib/                    # 工具函数
│   ├── utils.ts            # cn() Tailwind 类名合并
│   ├── pref-keys.ts        # 设置项键位定义
│   ├── report-session.ts   # 训练报告会话载荷缓存
│   └── tts-export.ts       # TTS 产物导入/导出
├── platform/               # 平台适配层
│   ├── recorder.ts         # WebRecorder（麦克风录音 → 16kHz WAV）
│   ├── html-player.ts      # HtmlPlayerController（媒体播放）
│   └── storage/            # 存储适配（IndexedDB + localStorage）
├── services/               # AI 服务层
│   ├── contracts.ts        # 服务接口定义（ASR/SOE/Report/TTS）
│   ├── index.ts            # 服务工厂（当前 mock，预留 API 切换）
│   └── mock/               # Mock 实现（离线可用）
├── stores/                 # 状态管理
│   ├── store.ts            # useSyncExternalStore 轻量封装
│   └── material-store.ts   # 材料库 store（CRUD + 排序 + 种子注入）
├── types/                  # TypeScript 类型定义
│   ├── material.ts         # 学习材料模型
│   ├── subtitle.ts         # 字幕数据模型
│   ├── training.ts         # 训练记录模型（五模式联合）
│   ├── progress.ts         # 学习进度 + 收藏模型
│   └── api.ts              # API 契约类型（SSE 事件、请求/响应）
├── public/                 # 静态资源（图标、占位图）
├── components.json         # shadcn/ui 配置
├── next.config.mjs         # Next.js 配置
├── tsconfig.json           # TypeScript 配置
├── vitest.config.mts       # Vitest 测试配置
├── postcss.config.mjs      # PostCSS 配置
└── package.json
```

## 快速开始

### 安装依赖

```bash
cd client
pnpm install
```

### 开发

```bash
pnpm dev          # 启动开发服务器（默认 http://localhost:3000）
```

### 构建

```bash
pnpm build        # 生产构建
pnpm start        # 启动生产服务器
```

### 测试

```bash
pnpm test         # 运行 core/ 和 services/mock 的单元测试
```

## 核心架构

### 本地优先（ADR-4）

所有用户数据（材料、进度、收藏、训练记录）存储在浏览器 IndexedDB 中，后端无状态无库。首次启动自动注入种子数据。

### 服务抽象层

AI 服务（ASR、SOE、TTS、报告生成）通过接口抽象，当前使用 Mock 实现（离线可用）。未来可通过环境变量切换为真实 Fastify 后端：

```typescript
// services/index.ts
export function getServices(mode: ServiceMode = 'mock'): AppServices {
  // 未来：NEXT_PUBLIC_SERVICE_MODE === 'api' ? getApiServices() : getMockServices()
  return getMockServices()
}
```

### 录音链路（ADR-5）

```
getUserMedia → MediaRecorder → AnalyserNode（声波动画）
    ↓ stop()
decodeAudioData → OfflineAudioContext（16kHz 单声道重采样）
    ↓
WAV Blob → ASR/SOE 服务
```

### 字幕解析器（ADR-2）

自研 SRT/LRC 双语字幕解析器，零依赖纯 TypeScript，支持：
- 行号容错报错
- 双语字幕自动识别
- 句级时间轴对齐

### 播放器控制器

- **Seek 落点校准**：seekTo 后静默旧进度，等待原生 timeupdate 到达实际落点
- **高频采样**：播放中使用 requestAnimationFrame（~60Hz）平滑进度条
- **A-B 循环**：controller 级区间循环，无次数限制

## 页面路由

| 路径 | 页面 | 功能 |
|------|------|------|
| `/` | Library | P0 材料库（最近学习排序） |
| `/import` | ImportPage | P1 导入音视频 + 字幕 |
| `/player/:materialId` | Player | P2 精听播放器（逐句播放、循环、倍速） |
| `/training/:materialId` | TrainingCenter | P3 训练中心（选择训练模式） |
| `/training/puzzle` | Puzzle | P4 九宫格选词拼句 |
| `/training/dictation` | Dictation | P5 单句听写 |
| `/transcribe` | TranscribePage | P6 录音转写（ASR） |
| `/training/shadowing` | Shadowing | P7 影子跟读 + SOE 评分 |
| `/training/recitation` | Recitation | P8 全文背诵 + LLM 报告 |
| `/training/read-aloud` | ReadAloud | P8.5 朗读评分 |
| `/training/report` | Report | P9 分析报告（SSE 流式） |
| `/settings` | SettingsPage | P10 设置（倍速、循环、录音模式） |
| `/tts` | TTS | P11 文字转语音（Kokoro-82M） |

## 数据模型

### Material（学习材料）

```typescript
interface Material {
  id: string                    // nanoid
  name: string                  // 材料名称
  mediaType: 'video' | 'audio'
  mediaRef: string              // IndexedDB Blob key
  mediaFileName: string
  mediaSizeBytes: number
  subtitle: {
    ref: string                 // 字幕文件本地引用
    format: 'srt' | 'lrc'
    isBilingual: boolean
    sentenceCount: number
  } | null
  durationMs: number
  createdAt: number
  lastOpenedAt: number
}
```

### TrainingRecord（训练记录）

五种训练模式的联合类型：

- **PuzzleDetail**：九宫格（完成句数、提示次数、是否一次通过）
- **DictationDetail**：听写（单句正确率、句子索引）
- **ReadAloudDetail**：朗读评分（综合分、准确度、流利度、完整度）
- **ReportDetail**：跟读/背诵报告（综合分、完整度、准确度、流利度、LLM 分析）

## 开发约定

- **路径别名**：`@/*` 映射到项目根目录
- **组件命名**：PascalCase（页面组件）、kebab-case（文件名）
- **状态管理**：使用自研 `createStore` + `useStore`，无外部状态库依赖
- **样式**：Tailwind CSS 4 + shadcn/ui，支持 light/dark 主题
- **代码风格**：函数 < 50 行，文件 < 800 行，不可变模式

## 相关文档

- [系统架构设计](../docs/系统架构设计.md)
- [原型设计](../docs/原型设计.md)
- [技术选型报告](../docs/技术选型报告.md)
