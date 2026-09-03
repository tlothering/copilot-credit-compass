import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeScript } from '@/components/theme-script';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { getRateCard } from '@/lib/engine/rate-card';

const card = getRateCard();

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: 'Copilot Credit Compass',
    template: '%s · Copilot Credit Compass',
  },
  description:
    'Estimate Microsoft Copilot credit consumption, model the cost, and get a defensible funding recommendation. No sign-in, no personal data, full working shown.',
  applicationName: 'Copilot Credit Compass',
  openGraph: {
    title: 'Copilot Credit Compass',
    description:
      'Model Microsoft Copilot credit consumption and funding strategy in about six minutes. Anonymous, transparent, and fully auditable.',
    type: 'website',
  },
  robots: { index: true, follow: true },
  other: { 'rate-card-version': card.version },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0c' },
    { media: '(prefers-color-scheme: light)', color: '#fbfaf8' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-100 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent focus:font-medium"
        >
          Skip to main content
        </a>
        <div className="flex min-h-dvh flex-col">
          <SiteHeader rateCardVersion={card.version} />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter rateCardVersion={card.version} effectiveDate={card.effectiveDate} />
        </div>
      </body>
    </html>
  );
}
