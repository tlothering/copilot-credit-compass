import Link from 'next/link';
import { ThemeToggle } from './theme-toggle';

const NAV = [
  { href: '/assess/0', label: 'Assess' },
  { href: '/benchmark', label: 'Benchmark' },
  { href: '/methodology', label: 'Methodology' },
  { href: '/privacy', label: 'Privacy' },
];

export function SiteHeader({ rateCardVersion }: { rateCardVersion: string }) {
  return (
    <header className="no-print sticky top-0 z-50 glass border-b border-line">
      <div className="mx-auto flex h-14 max-w-[86rem] items-center gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-semibold tracking-tight"
          aria-label="Copilot Credit Compass — home"
        >
          <CompassMark />
          <span className="hidden sm:inline">Copilot Credit Compass</span>
          <span className="sm:hidden">Compass</span>
        </Link>

        <nav aria-label="Primary" className="ml-auto hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-accent-quiet hover:text-fg"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <span
            className="hidden rounded-full border border-line px-2.5 py-1 font-mono text-2xs text-fg-subtle lg:inline"
            title="The rate card every figure on this site is calculated from"
          >
            rate card {rateCardVersion}
          </span>
          <ThemeToggle />
        </div>
      </div>

      <nav
        aria-label="Primary mobile"
        className="flex items-center gap-1 overflow-x-auto border-t border-line px-4 py-2 md:hidden"
      >
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-accent-quiet hover:text-fg"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

function CompassMark() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="9.25" stroke="var(--accent)" strokeWidth="1.5" />
      <path
        d="M15.6 8.4 13.4 13.4 8.4 15.6 10.6 10.6Z"
        fill="var(--accent)"
        stroke="var(--accent)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
