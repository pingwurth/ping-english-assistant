/**
 * 录音按钮 —— P6 跟读评分 / P8 全文背诵共用。
 * 点击切换开始/停止，文案"开始录音/停止录音"。
 */

function RecordButton({ recording, setRecording }: { recording:boolean; setRecording:(v:boolean)=>void }) {
  const label = recording ? '停止录音' : '开始录音'
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => setRecording(!recording)}
      className={`flex size-32 flex-col items-center justify-center rounded-full border-8 transition-all ${recording ? 'border-destructive/20 bg-destructive text-destructive-foreground' : 'border-primary/15 bg-primary text-primary-foreground'}`}
    >
      <span className="text-3xl">{recording ? '■' : '●'}</span>
      <span className="mt-1 text-sm">{label}</span>
    </button>
  )
}

export { RecordButton }
