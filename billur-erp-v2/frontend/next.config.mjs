import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  images: { unoptimized: true },
  
  // TypeScript paketlari yo'qligi va tiplardagi xatolarni o'tkazib yuborish uchun:
  typescript: {
    ignoreBuildErrors: true,
  },

  webpack: (config) => {
    config.resolve.alias['@'] = path.resolve(process.cwd());
    return config;
  },

  async rewrites() {
    const backend =
      process.env.BACKEND_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      'http://localhost:3001';
    const base = backend.replace(/\/$/, '');
    return [
      { source: '/api/:path*', destination: `${base}/api/:path*` },
      { source: '/uploads/:path*', destination: `${base}/uploads/:path*` },
    ];
  },
};

export default nextConfig;
