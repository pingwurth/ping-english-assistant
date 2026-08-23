/**
 * 服务入口：加载配置 → 装配 Fastify → Kokoro 模型预热 → 启动监听。
 */
import 'node:process';
import { loadConfig } from './config/env.js';
import { buildApp } from './app.js';
import { createTtsProvider, warmupTts } from './routes/tts.route.js';
import { sweep } from './lib/tempfiles.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

  // 临时文件定期清扫（录音即用即删兜底，§3.5）
  const sweepTimer = setInterval(() => void sweep(), 3600_000);
  sweepTimer.unref();

  // Kokoro 模型启动预热（CPU 密集，避免首请求慢，§8.1）
  if (config.TTS_PROVIDER === 'kokoro') {
    const provider = createTtsProvider(config);
    warmupTts(provider)
      .then(() => app.log.info('Kokoro-82M 模型预热完成'))
      .catch((e) => app.log.warn({ err: e }, 'Kokoro 模型预热失败（首次请求时将重试加载）'));
  }

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(`server listening on http://${config.HOST}:${config.PORT}`);
}

main().catch((e) => {
  console.error('启动失败:', e);
  process.exit(1);
});
