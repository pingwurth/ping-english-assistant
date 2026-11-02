/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // 默认让 build 捕获类型错误（仓库当前 tsc 零错）；仅在显式 SKIP_TSC=1 时关闭，
    // 用于临时绕过紧急发布。原先无条件 ignoreBuildErrors 使 strict 配置形同虚设。
    ignoreBuildErrors: process.env.SKIP_TSC === '1',
  },
  images: {
    unoptimized: true,
  },
  // 开发服务器允许的源：手机通过局域网 IP 访问时，Next.js 默认会拦截
  // 跨源的 /_next/* 资源请求（返回 403），导致页面白屏。
  // 用通配符覆盖整个网段，避免 DHCP 换 IP 后再次失效。
  allowedDevOrigins: ['192.168.110.*', '127.0.0.1'],
}

export default nextConfig
