import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Shell, PageIntro } from '@/components/shared/shell'
import { useTranscribe, TranscribeControls, TranscribeResult } from '@/components/shared/transcribe-shared'
import { downloadBlob } from '@/lib/download'
import { ModelConfigListDialog } from '@/components/shared/model-config-list-dialog'
import { writeTranscribeExport } from '@/lib/transcribe-export'
import { getTranslateEnabled, setTranslateEnabled as persistTranslateEnabled } from '@/lib/pref-keys'

export function TranscribePage() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const {
    method,
    setMethod,
    status,
    result,
    srt,
    editing,
    setEditing,
    error,
    start,
    cancel,
    handleSrtChange,
    showModelConfig,
    setShowModelConfig,
    handleModelConfigSaved,
    refreshConfigs,
    asrConfigs,
    selectedAsrConfigId,
    setSelectedAsrConfigId,
    translateEnabled,
    setTranslateEnabled,
    translateConfigs,
    selectedTranslateConfigId,
    setSelectedTranslateConfigId,
    translateWarning,
  } = useTranscribe()

  // 挂载时从偏好初始化翻译开关（仅一次）
  useEffect(() => {
    setTranslateEnabled(getTranslateEnabled())
  }, [setTranslateEnabled])

  // 切换开关时同步持久化偏好
  const handleToggleTranslate = useCallback((v: boolean) => {
    setTranslateEnabled(v)
    persistTranslateEnabled(v)
  }, [setTranslateEnabled])

  const handleDownloadSrt = useCallback(() => {
    if (!srt) return
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' })
    const name = file?.name.replace(/\.[^.]+$/, '') || 'subtitle'
    downloadBlob(`${name}.srt`, blob)
  }, [srt, file])

  const handleImport = useCallback(async () => {
    if (!file || !srt) return
    const taskId = crypto.randomUUID()
    const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 50)
    await writeTranscribeExport(taskId, file, {
      name: baseName,
      audioFileName: file.name,
      subtitleText: srt,
      subtitleFormat: 'srt',
      createdAt: Date.now(),
    })
    navigate(`/import?source=transcribe&taskId=${taskId}`)
  }, [file, srt, navigate])

  return (
    <Shell back>
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        <PageIntro title="音频转文字" eyebrow="AUDIO TRANSCRIPTION">
          <Badge variant="secondary">生成双语字幕</Badge>
        </PageIntro>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          {/* 左栏：上传 + 方式选择 */}
          <Card>
            <CardHeader>
              <CardTitle>1. 上传音频</CardTitle>
              <CardDescription>支持 mp3、wav、m4a、mp4，建议单个文件小于 500 MB</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-muted/40 p-6 text-center transition-colors hover:border-primary">
                <Upload className="text-primary" />
                <span className="font-medium">{file ? file.name : '点击选择音频或拖拽到这里'}</span>
                <span className="text-sm text-muted-foreground">本地文件不会自动上传</span>
                <Input
                  type="file"
                  accept="audio/*,video/*"
                  className="sr-only"
                  onChange={e => {
                    setFile(e.target.files?.[0] || null)
                    e.target.value = '' // 重置：同名文件在磁盘上被改过再重选也要触发 onChange
                  }}
                />
              </label>

              <div className="flex flex-col gap-3">
                <TranscribeControls
                  method={method}
                  onMethodChange={setMethod}
                  onConfigureLlm={() => setShowModelConfig(true)}
                  asrConfigs={asrConfigs}
                  selectedAsrConfigId={selectedAsrConfigId}
                  onAsrConfigChange={setSelectedAsrConfigId}
                  translateEnabled={translateEnabled}
                  onTranslateEnabledChange={handleToggleTranslate}
                  translateConfigs={translateConfigs}
                  selectedTranslateConfigId={selectedTranslateConfigId}
                  onTranslateConfigChange={setSelectedTranslateConfigId}
                  status={status}
                  canStart={!!file}
                  onStart={() => start(file)}
                  onCancel={cancel}
                />
              </div>
            </CardContent>
          </Card>

          {/* 右栏：结果 */}
          <Card>
            <CardHeader>
              <CardTitle>转换结果</CardTitle>
              <CardDescription>
                {status === 'idle'
                  ? '转换完成后将在这里预览字幕'
                  : status === 'running'
                    ? '正在分析音频并生成时间轴…'
                    : status === 'error'
                      ? '转换失败'
                      : editing
                        ? '编辑完成后可保存为 .srt 文件'
                        : '已生成字幕，可继续编辑'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-80 flex-col gap-4">
              {translateWarning && (
                <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
                  {translateWarning}
                </div>
              )}

              <TranscribeResult
                status={status}
                method={method}
                result={result}
                srt={srt}
                editing={editing}
                error={error}
                onRetry={() => start(file)}
                onToggleEdit={() => setEditing(!editing)}
                onSrtChange={handleSrtChange}
              />

              {status === 'done' && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={handleDownloadSrt}>
                    下载 .srt
                  </Button>
                  <Button onClick={() => void handleImport()}>导入为学习材料</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ModelConfigListDialog
        open={showModelConfig}
        onOpenChange={setShowModelConfig}
        onConfigsChanged={refreshConfigs}
        onSaved={handleModelConfigSaved}
      />
    </Shell>
  )
}
