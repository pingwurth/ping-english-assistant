/**
 * 材料库 Store（架构文档 §2.6）
 * 材料 CRUD、导入解析、进度/收藏持久化；本地优先（ADR-4）。
 */
import { defineStore } from 'pinia';
import { ref, shallowRef, toRaw } from 'vue';
import type { Favorite, LearningProgress, Material, TtsTask } from '@/types';
import type { SubtitleData } from '@/core/subtitle';
import { parseSubtitle } from '@/core/subtitle';
import { getStorage, StorageKeys } from '@/platform/storage';
import { genId } from '@/utils/id';
import { baseNameOf, mediaTypeOf } from '@/utils/file';

/** TTS 生成记录端内缓存时长：24h（原型设计 §3.4） */
const TTS_TASK_TTL_MS = 24 * 3600 * 1000;

export interface ImportInput {
  mediaFile: Blob | string;
  mediaFileName: string;
  mediaSizeBytes: number;
  subtitleText: string | null;
  subtitleFileName?: string;
  name?: string;
}

export const useMaterialStore = defineStore('material', () => {
  const materials = ref<Material[]>([]);
  const currentMaterial = ref<Material | null>(null);
  /** 避免整棵 subtitleData 进入响应式深层对象（架构文档 §2.6 性能要点） */
  const subtitleData = shallowRef<SubtitleData | null>(null);
  const progressMap = ref<Record<string, LearningProgress>>({});
  const favorites = ref<Favorite[]>([]);
  const ttsTasks = ref<TtsTask[]>([]);

  /** 启动时恢复端内持久数据 */
  async function restore(): Promise<void> {
    const storage = getStorage();
    materials.value = (await storage.getMeta<Material[]>(StorageKeys.materials)) ?? [];
    progressMap.value = (await storage.getMeta<Record<string, LearningProgress>>(StorageKeys.progress)) ?? {};
    favorites.value = (await storage.getMeta<Favorite[]>(StorageKeys.favorites)) ?? [];
    const tasks = (await storage.getMeta<TtsTask[]>(StorageKeys.ttsTasks)) ?? [];
    const now = Date.now();
    ttsTasks.value = tasks.filter((t) => now - t.createdAt < TTS_TASK_TTL_MS);
  }

  /** 导入材料：保存文件 → 解析字幕 → 写入材料库 */
  async function importMaterial(input: ImportInput): Promise<Material> {
    const storage = getStorage();
    const mediaRef = await storage.saveFile(input.mediaFile, input.mediaFileName);

    let subtitle: Material['subtitle'] = null;
    let parsed: SubtitleData | null = null;
    if (input.subtitleText) {
      parsed = parseSubtitle(input.subtitleText, undefined, input.subtitleFileName);
      let subtitleData: Blob | string;
      // #ifdef H5
      subtitleData = new Blob([input.subtitleText], { type: 'text/plain;charset=utf-8' });
      // #endif
      // #ifdef MP-WEIXIN
      subtitleData = await writeTextAsTempFile(input.subtitleText, input.subtitleFileName ?? 'subtitle.srt');
      // #endif
      const subRef = await storage.saveFile(subtitleData, input.subtitleFileName ?? 'subtitle.srt');
      subtitle = {
        ref: subRef,
        format: parsed.format,
        isBilingual: parsed.isBilingual,
        sentenceCount: parsed.sentences.length
      };
    }

    const material: Material = {
      id: genId(),
      name: input.name?.trim() || baseNameOf(input.mediaFileName),
      mediaType: mediaTypeOf(input.mediaFileName),
      mediaRef,
      mediaFileName: input.mediaFileName,
      mediaSizeBytes: input.mediaSizeBytes,
      subtitle,
      durationMs: parsed?.totalDurationMs ?? 0,
      createdAt: Date.now(),
      lastOpenedAt: Date.now()
    };
    materials.value.unshift(material);
    await persistMaterials();
    return material;
  }

  /** 打开材料：加载字幕解析结果、更新 lastOpenedAt */
  async function openMaterial(id: string): Promise<void> {
    const material = materials.value.find((m) => m.id === id);
    if (!material) throw new Error('材料不存在');
    material.lastOpenedAt = Date.now();
    currentMaterial.value = material;
    if (material.subtitle) {
      const text = await getStorage().readTextFile(material.subtitle.ref);
      subtitleData.value = parseSubtitle(text, material.subtitle.format);
    } else {
      subtitleData.value = null;
    }
    await persistMaterials();
  }

  async function removeMaterial(id: string): Promise<void> {
    const storage = getStorage();
    const material = materials.value.find((m) => m.id === id);
    if (material) {
      await storage.removeFile(material.mediaRef).catch(() => undefined);
      if (material.subtitle) await storage.removeFile(material.subtitle.ref).catch(() => undefined);
    }
    materials.value = materials.value.filter((m) => m.id !== id);
    delete progressMap.value[id];
    favorites.value = favorites.value.filter((f) => f.materialId !== id);
    if (currentMaterial.value?.id === id) {
      currentMaterial.value = null;
      subtitleData.value = null;
    }
    await persistMaterials();
    await persistProgress();
    await persistFavorites();
  }

  async function renameMaterial(id: string, name: string): Promise<void> {
    const material = materials.value.find((m) => m.id === id);
    if (material) {
      material.name = name;
      await persistMaterials();
    }
  }

  /** 记录句子被播放（精听/训练），驱动材料库进度条 */
  async function markSentencePlayed(materialId: string, sentenceIndex: number, positionMs = 0): Promise<void> {
    const p = progressMap.value[materialId] ?? {
      materialId,
      lastPositionMs: 0,
      playedSentenceIndexes: [],
      updatedAt: Date.now()
    };
    if (!p.playedSentenceIndexes.includes(sentenceIndex)) {
      p.playedSentenceIndexes.push(sentenceIndex);
    }
    if (positionMs > 0) p.lastPositionMs = positionMs;
    p.updatedAt = Date.now();
    progressMap.value[materialId] = p;
    await persistProgress();
  }

  async function toggleFavorite(materialId: string, sentenceIndex: number): Promise<boolean> {
    const idx = favorites.value.findIndex(
      (f) => f.materialId === materialId && f.sentenceIndex === sentenceIndex
    );
    if (idx >= 0) {
      favorites.value.splice(idx, 1);
      await persistFavorites();
      return false;
    }
    favorites.value.push({ materialId, sentenceIndex, createdAt: Date.now() });
    await persistFavorites();
    return true;
  }

  function isFavorited(materialId: string, sentenceIndex: number): boolean {
    return favorites.value.some(
      (f) => f.materialId === materialId && f.sentenceIndex === sentenceIndex
    );
  }

  function favoritesOf(materialId: string): number[] {
    return favorites.value
      .filter((f) => f.materialId === materialId)
      .map((f) => f.sentenceIndex);
  }

  /** TTS 生成记录缓存（24h 内可重复导入） */
  async function cacheTtsTask(task: TtsTask): Promise<void> {
    ttsTasks.value = [task, ...ttsTasks.value].slice(0, 20);
    await getStorage().setMeta(StorageKeys.ttsTasks, toRaw(ttsTasks.value));
  }

  function getTtsTask(taskId: string): TtsTask | null {
    return ttsTasks.value.find((t) => t.taskId === taskId) ?? null;
  }

  async function persistMaterials(): Promise<void> {
    await getStorage().setMeta(StorageKeys.materials, toRaw(materials.value));
  }

  async function persistProgress(): Promise<void> {
    await getStorage().setMeta(StorageKeys.progress, toRaw(progressMap.value));
  }

  async function persistFavorites(): Promise<void> {
    await getStorage().setMeta(StorageKeys.favorites, toRaw(favorites.value));
  }

  return {
    materials,
    currentMaterial,
    subtitleData,
    progressMap,
    favorites,
    ttsTasks,
    restore,
    importMaterial,
    openMaterial,
    removeMaterial,
    renameMaterial,
    markSentencePlayed,
    toggleFavorite,
    isFavorited,
    favoritesOf,
    cacheTtsTask,
    getTtsTask
  };
});

// #ifdef MP-WEIXIN
/** 小程序端：文本内容先写临时文件再另存（saveFile 仅接受文件路径） */
function writeTextAsTempFile(text: string, fileName: string): Promise<string> {
  const fs = uni.getFileSystemManager();
  const path = `${(uni as unknown as { env: { USER_DATA_PATH: string } }).env.USER_DATA_PATH}/${Date.now()}-${fileName}`;
  return new Promise((resolve, reject) => {
    fs.writeFile({
      filePath: path,
      data: text,
      encoding: 'utf8',
      success: () => resolve(path),
      fail: (err) => reject(new Error(err.errMsg))
    });
  });
}
// #endif
