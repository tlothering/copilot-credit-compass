import Link from 'next/link';
import { getRateCard } from '@/lib/engine/rate-card';
import { Badge } from '@/components/ui/primitives';
import { BenchmarkTicker } from '@/components/benchmark-ticker';

const card = getRateCard();

const STEPS = [
  { n: '01', t: 'Your organisation', d: 'Industry, size, agreement, M365 base. Six fields.' },
  { n: '02', t: 'What you are deploying', d: 'Pick from fourteen Copilot workloads.' },
  { n: '03', t: 'How hard you will use it', d: 'Volume drivers, or skip for industry defaults.' },
  { n: '04', t: 'Growth and appetite', d: 'Ramp curve, confidence, commitment tolerance.' },
  { n: '05', t: 'Your funding plan', d: 'Eight options scored, one recommended, working shown.' },
];

const PROOF = [
  { k: '14', v: 'Copilot workloads modelled' },
  { k: '8', v: 'Funding options scored' },
  { k: '3', v: 'Scenario bands per run' },
  { k: '0', v: 'Personal data collected' },
];

export default function HomePage() {
  return (
    <>
      {/* ------------------------------------------------------------ Hero */}
      <section className="mesh grain relative overflow-hidden border-b border-line">
        <div className="mx-auto max-w-[86rem] px-4 pt-20 pb-16 sm:px-6 sm:pt-28 sm:pb-24">
          <Badge tone="accent" className="mb-6">
            <span aria-hidden="true">●</span> Rate card {card.version} · effective{' '}
            {card.effectiveDate}
          </Badge>

          <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Find out what Microsoft Copilot will actually cost you — before you sign anything.
          </h1>

          <p className="mt-6 max-w-2xl text-lg text-fg-muted">
            Answer about twenty questions in six minutes. Get a credit consumption forecast, a
            three-band cost range, a funding recommendation across eight options, and the full
            arithmetic behind every number. No sign-in. No sales call. No personal data.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/assess/0"
              className="inline-flex h-12 items-center rounded-field bg-accent px-7 text-base font-medium text-on-accent transition-colors hover:bg-accent-hover"
            >
              Start the assessment
            </Link>
            <Link
              href="/methodology"
              className="inline-flex h-12 items-center rounded-field border border-line-strong px-6 text-base font-medium transition-colors hover:border-accent-line"
            >
              Read the methodology
            </Link>
          </div>

          <p className="mt-4 text-sm text-fg-subtle">
            Independent planning tool. Not a Microsoft price quotation.
          </p>

          <dl className="mt-14 grid max-w-3xl grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
            {PROOF.map((p) => (
              <div key={p.v}>
                <dt className="sr-only">{p.v}</dt>
                <dd>
                  <span className="block text-3xl font-semibold tracking-tight mono-num">
                    {p.k}
                  </span>
                  <span className="mt-1 block text-sm text-fg-muted">{p.v}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* --------------------------------------------------------- The flow */}
      <section className="mx-auto max-w-[86rem] px-4 py-20 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <p className="mt-2 max-w-2xl text-fg-muted">
          Every question can be skipped. Skipping applies a documented industry default and the
          result is flagged lower-confidence — it never silently guesses.
        </p>

        <ol className="mt-10 grid gap-4 md:grid-cols-3 lg:grid-cols-5">
          {STEPS.map((s) => (
            <li key={s.n} className="card p-5">
              <span className="mono-num text-2xs text-accent">{s.n}</span>
              <h3 className="mt-2 font-medium tracking-tight">{s.t}</h3>
              <p className="mt-1.5 text-sm text-fg-muted">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------------------------------------------- What you get */}
      <section className="border-y border-line bg-bg-sunken">
        <div className="mx-auto max-w-[86rem] px-4 py-20 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">What you walk away with</h2>
          <div className="bento mt-10">
            <Feature
              span="lg:col-span-6"
              title="The licence-offset break-even"
              body="Microsoft 365 Copilot includes a monthly credit allowance per seat. We calculate the exact consumption level at which buying a $30 seat is cheaper than paying for credits — then tell you how many of your users are above that line."
            />
            <Feature
              span="lg:col-span-6"
              title="Eight funding options, scored"
              body="Pay-as-you-go, capacity packs, pack + PAYG, prepaid P3, P3 + PAYG, P3 + packs + PAYG, licence shift, and bring-your-own Foundry models. Each with a twelve-month total, eligibility test, and named trade-off."
            />
            <Feature
              span="lg:col-span-4"
              title="Three scenario bands"
              body="Conservative, expected, aggressive — derived from your stated confidence, not invented percentages."
            />
            <Feature
              span="lg:col-span-4"
              title="A full audit trail"
              body="Every step, its formula, its inputs, its output, and the rate card row it used. Exportable."
            />
            <Feature
              span="lg:col-span-4"
              title="Exports that survive scrutiny"
              body="PDF board pack, Excel model with live formulas you can edit, and a PowerPoint summary."
            />
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- Benchmark */}
      <section className="mx-auto max-w-[86rem] px-4 py-20 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Anonymous benchmark, built by everyone who runs it
            </h2>
            <p className="mt-2 max-w-2xl text-fg-muted">
              Opt in and your run joins an aggregate no one can trace back to you. Cohorts publish
              only once at least five organisations sit inside them.
            </p>
          </div>
          <Link
            href="/benchmark"
            className="inline-flex h-10 items-center rounded-field border border-line-strong px-5 text-sm font-medium transition-colors hover:border-accent-line"
          >
            Explore the benchmark
          </Link>
        </div>
        <BenchmarkTicker />
      </section>
    </>
  );
}

function Feature({ span, title, body }: { span: string; title: string; body: string }) {
  return (
    <div className={`card p-6 ${span}`}>
      <h3 className="font-medium tracking-tight">{title}</h3>
      <p className="mt-2 text-sm text-fg-muted">{body}</p>
    </div>
  );
}
