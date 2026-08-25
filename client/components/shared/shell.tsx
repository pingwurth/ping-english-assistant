import { Link } from 'react-router-dom'
import { ArrowLeft, Headphones, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'

function Shell({ children, back }: { children: React.ReactNode; back?: boolean }) {
  return <div className="min-h-screen bg-background text-foreground"><header className="border-b bg-card/90 backdrop-blur"><div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 md:px-8"><div className="flex items-center gap-3">{back && <Link to="/"><Button variant="ghost" size="icon" aria-label="返回"><ArrowLeft /></Button></Link>}<Link to="/" className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Headphones /></span><span className="font-serif text-lg font-semibold tracking-tight">英语精听助手</span></Link></div><Link to="/settings"><Button variant="ghost" size="icon" aria-label="设置"><Settings /></Button></Link></div></header><main>{children}</main></div>
}
function PageIntro({ title, eyebrow, children }: { title: string; eyebrow?: string; children?: React.ReactNode }) { return <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow || 'LEARN BY LISTENING'}</p><h1 className="font-serif text-4xl font-semibold tracking-tight md:text-5xl">{title}</h1></div>{children}</div> }

export { Shell, PageIntro }
