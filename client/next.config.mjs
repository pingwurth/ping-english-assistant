/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
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
