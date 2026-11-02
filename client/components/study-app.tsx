'use client'

import { useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { setKokoroModelId, preloadKokoroModel } from '@/platform/kokoro-tts'
import { subscribeIdbBlocked } from '@/platform/storage/idb'
import { sweepTrainingRetention } from '@/stores/training-record-store'
import { Library } from '@/components/pages/library'
import { CollectionDetail } from '@/components/pages/collection'
import { Favorites } from '@/components/pages/favorites'
import { ImportPage } from '@/components/pages/import'
import { Player } from '@/components/pages/player'
import { TrainingCenter } from '@/components/pages/training-center'
import { Puzzle } from '@/components/pages/puzzle'
import { Dictation } from '@/components/pages/dictation'
import { ReadAloud } from '@/components/pages/training/read-aloud'
import { Shadowing } from '@/components/pages/training/shadowing'
import { Recitation } from '@/components/pages/training/recitation'
import { TTS } from '@/components/pages/tts'
import { TranscribePage } from '@/components/pages/transcribe'
import { SettingsPage } from '@/components/pages/settings'
import { Vocabulary } from '@/components/pages/vocabulary'
import { MnemonicPage } from '@/components/pages/mnemonic'
import { Placeholder } from '@/components/pages/placeholder'

export default function StudyApp() {
  const [ready, setReady] = useState(false)
  const [idbBlocked, setIdbBlocked] = useState(false)

  useEffect(() => {
    const unsubscribeIdb = subscribeIdbBlocked(setIdbBlocked)
    setReady(true)
    // 启动时加载 Kokoro 配置并预加载模型
    // 后台清扫训练记录保留策略（只读 train: 前缀；兜住升级前/导入的历史积压，失败静默）
    void sweepTrainingRetention().catch(() => {})
    fetch('/api/settings/kokoro')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.modelId) setKokoroModelId(data.modelId)
      })
      .catch(() => {})
      .finally(() => { preloadKokoroModel() })
    return () => {
      unsubscribeIdb()
    }
  }, [])

  if (!ready) return null

  return (
    <BrowserRouter>
      {idbBlocked && (
        <div role="alert" className="fixed inset-x-0 top-0 z-[100] bg-amber-500/95 px-4 py-2 text-center text-sm font-medium text-black">
          本页正在等待其他标签页释放本地数据库升级锁；请保存并关闭旧标签页后继续。
        </div>
      )}
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/collection/:collectionId" element={<CollectionDetail />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/player/:materialId" element={<Player />} />
        <Route path="/training/:materialId" element={<TrainingCenter />} />
        <Route path="/training/puzzle" element={<Puzzle />} />
        <Route path="/training/dictation" element={<Dictation />} />
        <Route path="/training/read-aloud" element={<ReadAloud />} />
        <Route path="/training/shadowing" element={<Shadowing />} />
        <Route path="/training/recitation" element={<Recitation />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/transcribe" element={<TranscribePage />} />
        <Route path="/tts" element={<TTS />} />
        <Route path="/vocabulary" element={<Vocabulary />} />
        <Route path="/vocabulary/mnemonic/:entryId" element={<MnemonicPage />} />
        <Route path="*" element={<Placeholder title="页面未找到" />} />
      </Routes>
    </BrowserRouter>
  )
}
