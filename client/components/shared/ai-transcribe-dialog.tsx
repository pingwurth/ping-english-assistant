import { useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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
    translateEnabled,
    setTranslateEnabled,
    translateConfigs,
    selectedTranslateConfigId,
    setSelectedTranslateConfigId,
    translateWarning,
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

              {(method === 'model' || method === 'local') && (
                <div className="flex flex-col gap-2 rounded-xl bg-muted p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">翻译</span>
                    <Switch
                      checked={translateEnabled}
                      onCheckedChange={setTranslateEnabled}
                      aria-label="翻译开关"
                    />
                    {translateEnabled && (
                      <select
                        value={selectedTranslateConfigId || ''}
                        onChange={e => setSelectedTranslateConfigId(e.target.value)}
                        disabled={translateConfigs.length === 0}
                        className="rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-50"
                      >
                        {translateConfigs.map(c => (
                          <option key={c.id} value={c.id}>{c.translateModel} · {c.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  {translateEnabled && translateConfigs.length === 0 && (
                    <p className="text-xs text-destructive">请先在「设置 → 模型配置」中配置翻译模型</p>
                  )}
                </div>
              )}

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
