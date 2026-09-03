import Link from 'next/link';

export function SiteFooter({
  rateCardVersion,
  effectiveDate,
}: {
  rateCardVersion: string;
  effectiveDate: string;
}) {
  return (
    <footer className="no-print mt-24 border-t border-line bg-bg-sunken">
      <div className="mx-auto grid max-w-[86rem] gap-8 px-4 py-10 sm:px-6 md:grid-cols-[2fr_1fr_1fr]">
        <div className="max-w-md space-y-3">
          <p className="font-semibold">Copilot Credit Compass</p>
          <p className="text-sm text-fg-muted">
            An independent planning tool. Not affiliated with, endorsed by, or a price quotation
            from Microsoft. Every figure is modelled from rate card{' '}
            <span className="font-mono text-fg">{rateCardVersion}</span>, effective{' '}
            <span className="font-mono text-fg">{effectiveDate}</span>. Confirm all pricing with
            your Microsoft account team before you commit money.
          </p>
        </div>

        <nav aria-label="Footer" className="space-y-2 text-sm">
          <p className="font-medium">The tool</p>
          <ul className="space-y-1.5 text-fg-muted">
            <li>
              <Link className="hover:text-fg" href="/assess/0">
                Start an assessment
              </Link>
            </li>
            <li>
              <Link className="hover:text-fg" href="/benchmark">
                Public benchmark
              </Link>
            </li>
            <li>
              <Link className="hover:text-fg" href="/methodology">
                Methodology &amp; rate card
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label="Footer legal" className="space-y-2 text-sm">
          <p className="font-medium">Your data</p>
          <ul className="space-y-1.5 text-fg-muted">
            <li>
              <Link className="hover:text-fg" href="/privacy">
                What we collect
              </Link>
            </li>
            <li className="text-fg-subtle">No accounts. No cookies for tracking.</li>
            <li className="text-fg-subtle">Results live in your browser only.</li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
