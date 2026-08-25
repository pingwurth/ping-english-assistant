/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // 开发服务器允许的源（用于跨域资源共享CORS）
  allowedDevOrigins: ['192.168.110.51', "127.0.0.1"],
}

export default nextConfig
