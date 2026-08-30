# 英语精听助手 · ping-english-assistant

English listening/dictation/shadowing training app. Local-first SPA for PC Web + Mobile H5.

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | Next.js (App Router, SPA shell) | 16.3.0 |
| UI 库 | React | 19 |
| 语言 | TypeScript | 5.7.3 |
| 路由 | React Router DOM | 7.18.2 |
| 样式 | Tailwind CSS | 4.3.3 |
| 组件库 | shadcn/ui (base-nova) | 4.8.0 |
| 图标 | Lucide React | 1.16.0 |
| 状态管理 | useSyncExternalStore (自研轻量 store) | — |
| 本地存储 | IndexedDB (手写 Promise wrapper) | — |
| 测试 | Vitest | 4.1.11 |
| 包管理 | pnpm | — |
| 转写服务 | Python FastAPI + faster-whisper | — |
| 对齐服务 | Python FastAPI + WhisperX | — |

## 目录结构

```
ping-english-assistant/
├── client/                 # 前端 SPA（Next.js + React）
│   ├── app/                # Next.js App Router（仅作 SPA shell）
│   ├── components/
│   │   ├── pages/          # 页面组件（P0-P11）
│   │   ├── pages/training/ # 训练模式（影子跟读、背诵、朗读）
│   │   ├── shared/         # 共享业务组件
│   │   └── ui/             # shadcn/ui 基础组件
│   ├── core/               # 平台无关纯 TS 逻辑
│   │   ├── audio/          # WAV 编码器（16kHz mono）
│   │   ├── player/         # SentencePlayer 播放器抽象
│   │   ├── subtitle/       # SRT/LRC 字幕解析器
│   │   └── training/       # 训练逻辑（听写、九宫格、评分）
│   ├── platform/           # 浏览器适配层
│   │   ├── html-player.ts  # HTMLAudioElement 控制器
│   │   ├── recorder.ts     # 麦克风录音 → 16kHz WAV
│   │   └── storage/        # IndexedDB + localStorage
│   ├── services/           # AI 服务层（接口 + mock）
│   ├── stores/             # 自研状态管理（createStore + useStore）
│   ├── types/              # TypeScript 类型定义
│   ├── lib/                # 工具函数
│   ├── data/               # 种子数据
│   └── public/             # 静态资源
├── server/                 # Python 后端服务
│   ├── transcribe_server.py  # faster-whisper 转写服务（端口 8766）
│   ├── align_server.py       # WhisperX 对齐服务（端口 8765）
│   ├── start.sh              # 启动脚本
│   └── requirements.txt      # Python 依赖
├── page-prototype/         # 原型沙箱（独立 Next.js，设计迭代用）
├── docs/                   # 设计文档（中文）
└── README.md               # 本文件
```

## 快速开始

### 前端（client/）

```bash
cd client
pnpm install          # 安装依赖（使用 pnpm，非 npm）
pnpm dev              # 启动开发服务器 → http://localhost:3000
pnpm build            # 生产构建
pnpm test             # 运行单元测试（Vitest, core/ 和 services/mock/）
npx tsc --noEmit      # 类型检查
```

### 后端（server/）

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 启动转写服务（CPU 模式）
./start.sh

# 启动对齐服务（GPU 模式）
./start.sh --server align --device cuda

# 同时启动两个服务
./start.sh --server both --device auto
```

转写服务默认运行在 `http://localhost:8766`，对齐服务默认运行在 `http://localhost:8765`。

## 架构

### SPA inside Next.js

Next.js App Router 仅作为 SPA shell，所有页面都是 `'use client'` 组件，无 SSR 业务逻辑。客户端路由通过 react-router-dom 7.x 实现：

- `app/page.tsx` → 渲染 `<StudyApp />`
- `app/[...slug]/page.tsx` → catch-all 路由，同样渲染 `<StudyApp />`
- `components/study-app.tsx` → `BrowserRouter` + 14 条路由

### 六层架构

```
Core（平台无关纯 TS）→ Platform（浏览器实现）→ Services（AI 服务契约）
       ↓                        ↓                        ↓
   Stores（状态管理）← Components（页面 + 共享组件）← Types（类型定义）
```

| 层级 | 路径 | 职责 |
|------|------|------|
| Core | `core/` | 平台无关纯 TS（字幕解析、训练逻辑、WAV 编码），可在 Node 中运行测试 |
| Platform | `platform/` | 浏览器实现（HTMLAudioElement 控制器、getUserMedia 录音、IndexedDB 存储） |
| Services | `services/` | AI 服务契约（ASR、SOE、TTS、报告），接口定义在 `contracts.ts`，mock 在 `mock/` |
| Stores | `stores/` | 自研 `createStore` + `useStore`（基于 React `useSyncExternalStore`），无外部依赖 |
| Components | `components/` | 页面组件（P0-P11）、共享组件、shadcn/ui 基础组件 |
| Types | `types/` | Material、Subtitle、Training、Progress、API 类型定义 |

### 关键设计决策

- **本地优先**：所有用户数据存储在浏览器 IndexedDB，后端无状态无数据库。首次加载自动注入 4 条种子材料。
- **服务契约模式**：AI 服务通过接口抽象（`services/contracts.ts`），当前返回 mock 实现，未来通过 `NEXT_PUBLIC_SERVICE_MODE` 环境变量切换真实 API。
- **录音链路**：`getUserMedia → MediaRecorder → OfflineAudioContext（16kHz 单声道重采样）→ WAV Blob`，专为 ASR/SOE 兼容性设计。
- **字幕解析器**：自研 SRT/LRC 双语解析器，零依赖纯 TypeScript，支持行号容错报错和句级时间轴对齐。
- **播放器 Seek 校准**：seek 后静默旧进度，等待原生 timeupdate 到达实际落点（SEEK_DRIFT_THRESHOLD_MS = 300ms）。
- **14 条客户端路由**：Library → Import → Player → Training Center → Puzzle/Dictation/Shadowing/Recitation/ReadAloud → Report → Settings → TTS → Transcribe。

### 服务端

| 服务 | 端口 | 技术 | 功能 |
|------|------|------|------|
| 转写服务 | 8766 | Python FastAPI + faster-whisper | 音频转文字（ASR），支持自动语言检测 |
| 对齐服务 | 8765 | Python FastAPI + WhisperX | 强制对齐，生成精准词级时间戳 |

## 页面路由

| 路径 | 页面 | 功能 |
|------|------|------|
| `/` | Library | P0 材料库（最近学习排序） |
| `/import` | ImportPage | P1 导入音视频 + 字幕 |
| `/player/:materialId` | Player | P2 精听播放器（逐句播放、A-B 循环、倍速） |
| `/training/:materialId` | TrainingCenter | P3 训练中心（选择训练模式） |
| `/training/puzzle` | Puzzle | P4 九宫格选词拼句 |
| `/training/dictation` | Dictation | P5 单句听写 |
| `/transcribe` | TranscribePage | P6 录音转写（OpenAI Whisper 兼容模式） |
| `/training/shadowing` | Shadowing | P7 影子跟读 + SOE 评分 |
| `/training/recitation` | Recitation | P8 全文背诵 + LLM 报告 |
| `/training/read-aloud` | ReadAloud | P8.5 朗读评分 |
| `/training/report` | Report | P9 分析报告（SSE 流式） |
| `/settings` | SettingsPage | P10 设置（播放/训练、模型配置、存储管理） |
| `/tts` | TTS | P11 文字转语音 |

## 设计理念

> 眼耳手嘴脑共用记住 80%，只靠眼睛记住不到 20%。

精听助手的核心目标不是"看懂"，而是"听懂、会说、能写"。每一个训练模式都围绕多感官协同设计：耳朵听音、嘴巴跟读、手写听写、脑子理解——五感并用，记忆留存率远超被动阅读。

## 功能展望

| 方向 | 功能 | 说明 |
|------|------|------|
| **转写增强** | 双语转写 | 中英双语字幕同时生成 |
| | 多种模型支持 | 接入更多 ASR 模型（OpenAI Whisper 兼容、本地 faster-whisper 等） |
| **词汇学习** | 生词收藏 | 标记生词，集中复习 |
| | 生词出现频率统计 | 统计生词在材料中出现的频次，识别高频词 |
| | 生词刻骨铭心模式 | 多维度深度记忆：发音分段助记、抽象有趣联想、词根词缀拆解、例句语境、词组与固定搭配、近义词辨析、相关话题或故事、核心含义和引申义、文化与历史背景、真题练习、听力真题练习、独立造句练习 |
| **句子精析** | 句子解析 | 逐句拆解结构，标注主干与修饰成分 |
| | 发音指导 | 标注重音、连读、弱读、吞音等发音要点 |
| | 句子结构分析 | 句型分类（简单句、复合句、并列句等） |
| | 语法详解 | 标注时态、语态、从句类型、虚拟语气等语法点 |
| | AI 长难句拆解训练 | AI 分析长难句，出题引导用户一步步完成拆解（识别主干→切分从句→标注修饰→还原语序） |
| **AI 辅助** | AI 纠错 | 听写/造句后 AI 自动纠正错误并给出解释 |
| | AI 写作指导 | 基于听力材料的写作思路引导 |
| | AI 写作批改 | AI 批改作文，给出评分与改进建议 |
| **写与说训练** | 逻辑训练 | 训练英语表达逻辑：总分总、因果、对比、举例等常用论证结构 |
| | 写作训练 | 从句子→段落→篇章递进，配合模板与仿写练习 |
| | 口语训练 | 围绕话题展开口语输出，结合模板框架与自由表达 |
| | 写作/口语模板库 | 提供高频场景模板（议论文、书信、演讲、日常对话等），降低起步门槛 |
| **考试备考** | 雅思考试资料整理 | 按难度递进编排（简→难），顺序攻略教程 |
| **使用指引** | 新手引导 | 首次使用交互式指引，快速上手各训练模式 |

## 开发约定

- **路径别名**：`@/*` 映射到 `client/` 根目录
- **包管理**：pnpm（lockfile 在 `client/pnpm-lock.yaml`）
- **UI 库**：shadcn/ui base-nova 样式，Lucide 图标，Tailwind CSS 4
- **状态管理**：自研 `createStore` + `useStore`，无 zustand/Pinia 等外部依赖
- **测试**：Vitest 4.x，node 环境，仅测试 core/ 和 services/mock/，测试文件位于 `__tests__/` 目录
- **代码风格**：函数 < 50 行，文件 < 800 行，不可变模式，无 ESLint/Prettier 配置
- **文档语言**：代码注释和设计文档使用中文

## 相关文档

- [客户端文档](client/README.md) — 前端架构、数据模型、开发指南
- [服务端文档](server/README.md) — Python 服务部署、API 接口、模型管理
- [系统架构设计](docs/系统架构设计.md) — ADR 1-7，架构决策记录
- [技术选型报告](docs/技术选型报告.md) — 技术评估与选型依据
- [原型设计](docs/原型设计.md) — 交互原型与页面流程
