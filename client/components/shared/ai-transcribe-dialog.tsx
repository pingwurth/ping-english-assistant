import { useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent } from '@/components/ui/dialog'
import { useTranscribe, MethodSelector, MethodHint, TranscribeResult } from './transcribe-shared'
import { ModelConfigListDialog } from './model-config-list-dialog'

interface AiTranscribeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mediaFile: File | null
  onSubtitleGenerated: (srtText: string) => void
}

export function AiTranscribeDialog({ open, onOpenChange, mediaFile, onSubtitleGenerated }: AiTranscribeDialogProps) {
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
    reset,
    handleSrtChange,
    showModelConfig,
    setShowModelConfig,
    handleModelConfigSaved,
    refreshConfigs,
    asrConfigs,
    selectedAsrConfigId,
    setSelectedAsrConfigId,
  } = useTranscribe()

  const handleImport = useCallback(() => {
    if (!srt) return
    onSubtitleGenerated(srt)
    onOpenChange(false)
    reset()
  }, [srt, onSubtitleGenerated, onOpenChange, reset])

  const handleClose = useCallback((open: boolean) => {
    if (!open) {
      cancel()
    }
    onOpenChange(open)
  }, [onOpenChange, cancel])

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogHeader>
          <DialogTitle>AI 音频转字幕</DialogTitle>
          <DialogDescription>
            {mediaFile
              ? `使用 ${mediaFile.name} 生成字幕`
              : '当前材料没有媒体文件，无法生成字幕'}
          </DialogDescription>
        </DialogHeader>

        <DialogContent>
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            {/* 左栏：方式选择 */}
            <div className="flex flex-col gap-4">
              <MethodSelector method={method} setMethod={setMethod} />
              <MethodHint
                method={method}
                onConfigureLlm={() => setShowModelConfig(true)}
                asrConfigs={asrConfigs}
                selectedAsrConfigId={selectedAsrConfigId}
                onAsrConfigChange={setSelectedAsrConfigId}
              />

              {status === 'running' ? (
                <Button className="w-full" variant="destructive" onClick={cancel}>
                  取消转换
                </Button>
              ) : (
                <Button
                  className="w-full"
                  disabled={!mediaFile || method === 'third-party'}
                  onClick={() => start(mediaFile)}
                >
                  {status === 'error' ? '重新转换' : '开始转换'}
                </Button>
              )}
            </div>

            {/* 右栏：结果 */}
            <TranscribeResult
              status={status}
              method={method}
              result={result}
              srt={srt}
              editing={editing}
              error={error}
              onRetry={() => start(mediaFile)}
              onToggleEdit={() => setEditing(!editing)}
              onSrtChange={handleSrtChange}
            />

            {status === 'done' && !editing && (
              <div className="flex justify-end">
                <Button onClick={handleImport}>
                  导入字幕
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ModelConfigListDialog
        open={showModelConfig}
        onOpenChange={setShowModelConfig}
        onConfigsChanged={refreshConfigs}
        onSaved={handleModelConfigSaved}
      />
    </>
  )
}
