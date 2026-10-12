import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // PGlite (local dev only) loads its WASM from disk; never bundle it.
  serverExternalPackages: ['@electric-sql/pglite'],
  poweredByHeader: false,
}

export default nextConfig
