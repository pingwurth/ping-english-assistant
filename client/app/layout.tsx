import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'

/**
 * Vercel Web Analytics 默认关闭（2026-11 全仓复审 c079）：<Analytics/> 会上报页面
 * 浏览（路径含 /player/:materialId 等素材标识），与 README「本地优先、后端无状态」
 * 的隐私承诺冲突 —— 此前生产构建无条件挂载且无任何披露。需要部署侧统计时，
 * 显式设置 NEXT_PUBLIC_ENABLE_ANALYTICS=1 再构建（并在 README 披露）。
 */
const ANALYTICS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === '1'

export const metadata: Metadata = {
  title: '英语精听助手 · 逐句听懂每一句',
  description: '面向英语精听、听写与跟读训练的本地优先学习工具。',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        {ANALYTICS_ENABLED && process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
