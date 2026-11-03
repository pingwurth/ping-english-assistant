import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Headphones, Settings, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * 暂停所有活动的媒体元素（视频/音频）
 * 解决视频播放时点击返回按钮因主线程被占用而无响应的问题
 */
function pauseAllMedia() {
  document.querySelectorAll('video, audio').forEach((el) => {
    if (el instanceof HTMLMediaElement && !el.paused) {
      el.pause()
    }
  })
}

function Shell({ children, back }: { children: React.ReactNode; back?: boolean }) {
  const navigate = useNavigate()
  // 移动端导航胶囊展开态：点击左上角小图标横向展开；路由切换时 Shell 随页面重挂载自然收起
  const [menuOpen, setMenuOpen] = useState(false)
  // 亮玻璃底上的按钮：深色字（浅色模式）+ 淡淡的主色 hover 高亮
  const onGlass = 'text-foreground hover:bg-primary/10 hover:text-foreground'
  return <div className="min-h-screen bg-background text-foreground">
    {/* 移动端（<md）：导航折叠为贴左上角边缘的小箭头（置顶悬浮、不占布局空间），点击横向展开；极轻玻璃：10% 白 + 2px 微磨砂（下层淡灰文字仍可透出），质感靠白边+顶边高光 */}
    <div className="fixed left-0 top-0 z-50 md:hidden"><div className="flex items-center gap-0.5 rounded-br-full border border-l-0 border-t-0 border-white/50 bg-card/10 p-1 pr-2 pb-2 text-foreground shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-[2px]"><Button variant="ghost" size="icon" className={onGlass} aria-label={menuOpen ? '收起导航' : '展开导航'} aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)}>{menuOpen ? <ChevronLeft /> : <ChevronRight />}</Button>{menuOpen && <>{back && <Button variant="ghost" size="icon" className={onGlass} aria-label="返回" onClick={() => { pauseAllMedia(); navigate(-1) }}><ArrowLeft /></Button>}<Link to="/favorites"><Button variant="ghost" size="icon" className={onGlass} aria-label="句子收藏"><Star /></Button></Link><Link to="/vocabulary"><Button variant="ghost" size="icon" className={onGlass} aria-label="生词本"><BookOpen /></Button></Link><Link to="/settings"><Button variant="ghost" size="icon" className={onGlass} aria-label="设置"><Settings /></Button></Link></>}</div></div>
    {/* 桌面端（≥md）：沿用原顶栏 */}
    <header className="hidden border-b bg-card/90 backdrop-blur md:block"><div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 md:px-8"><div className="flex items-center gap-3">{back && <Button variant="ghost" size="icon" aria-label="返回" onClick={() => { pauseAllMedia(); navigate(-1) }}><ArrowLeft /></Button>}<Link to="/" className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Headphones /></span><span className="font-serif text-lg font-semibold tracking-tight">英语精听助手</span></Link></div><div className="flex items-center gap-1"><Link to="/favorites"><Button variant="ghost" size="icon" aria-label="句子收藏"><Star /></Button></Link><Link to="/vocabulary"><Button variant="ghost" size="icon" aria-label="生词本"><BookOpen /></Button></Link><Link to="/settings"><Button variant="ghost" size="icon" aria-label="设置"><Settings /></Button></Link></div></div></header>
    <main>{children}</main>
  </div>
}
function PageIntro({ title, eyebrow, children }: { title: string; eyebrow?: string; children?: React.ReactNode }) { return <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow || 'LEARN BY LISTENING'}</p><h1 className="font-serif text-4xl font-semibold tracking-tight md:text-5xl">{title}</h1></div>{children}</div> }

export { Shell, PageIntro, pauseAllMedia }
