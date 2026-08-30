'use client'

import { useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { setKokoroModelId, preloadKokoroModel } from '@/platform/kokoro-tts'
import { Library } from '@/components/pages/library'
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
import { Report } from '@/components/pages/report'
import { Vocabulary } from '@/components/pages/vocabulary'
import { Placeholder } from '@/components/pages/placeholder'

export default function StudyApp() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
    // 启动时加载 Kokoro 配置并预加载模型
    fetch('/api/settings/kokoro')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.modelId) setKokoroModelId(data.modelId)
      })
      .catch(() => {})
      .finally(() => { preloadKokoroModel() })
  }, [])

  if (!ready) return null

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/player/:materialId" element={<Player />} />
        <Route path="/training/:materialId" element={<TrainingCenter />} />
        <Route path="/training/puzzle" element={<Puzzle />} />
        <Route path="/training/dictation" element={<Dictation />} />
        <Route path="/training/read-aloud" element={<ReadAloud />} />
        <Route path="/training/shadowing" element={<Shadowing />} />
        <Route path="/training/recitation" element={<Recitation />} />
        <Route path="/training/report" element={<Report />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/transcribe" element={<TranscribePage />} />
        <Route path="/tts" element={<TTS />} />
        <Route path="/vocabulary" element={<Vocabulary />} />
        <Route path="*" element={<Placeholder title="页面未找到" />} />
      </Routes>
    </BrowserRouter>
  )
}
