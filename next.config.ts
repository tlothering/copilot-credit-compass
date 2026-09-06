import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  serverExternalPackages: ['exceljs', 'pptxgenjs', '@azure/cosmos', '@azure/identity'],

  // pdfkit (via @react-pdf/renderer) loads its AFM metrics for the 14 standard
  // PDF fonts through a `require()` whose path is built at run time, so Next's
  // static tracer cannot see it and omits the whole directory from the
  // standalone bundle. Dev and `next start` still work because the full
  // node_modules tree is on disk — the failure only appears in the container,
  // as a 500 on the PDF export. Tracing the files in explicitly is the fix.
  outputFileTracingIncludes: {
    '/api/export/[kind]': ['./node_modules/pdfkit/js/standard-fonts/**'],
  },

  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
