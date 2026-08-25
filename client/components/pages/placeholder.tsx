import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Shell, PageIntro } from '@/components/shared/shell'

function Placeholder({ title }: { title:string }) { return <Shell back><div className="mx-auto max-w-2xl px-4 py-10"><PageIntro title={title} eyebrow="COMING NEXT" /><Card><CardContent className="flex flex-col items-center gap-5 p-12 text-center"><Sparkles className="text-primary" /><p className="text-muted-foreground">已准备好训练流程入口，录音与 AI 分析将在后续接入。</p><Link to="/training/report"><Button>查看演示报告</Button></Link></CardContent></Card></div></Shell> }

export { Placeholder }
