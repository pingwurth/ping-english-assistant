# 英语精听助手后端（Fastify + Kokoro-82M TTS 本地推理）
# 模型文件（q8 约 90MB）随镜像打包；内存 ≥1GB（架构文档 §7）
FROM node:20-slim AS base
WORKDIR /app

# ---- 依赖 ----
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---- 构建 ----
FROM deps AS build
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- 运行时 ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY src/prompts ./dist/prompts

# 如需 MP3 输出（可选）：取消下行注释安装 ffmpeg
# RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
