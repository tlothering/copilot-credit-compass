import type { Metadata } from 'next';
import Link from 'next/link';
import { getRateCard } from '@/lib/engine/rate-card';
import { Badge, Card, CardTitle } from '@/components/ui/primitives';
import { DISCLAIMER, SESSION_BANNER } from '@/lib/export/copy';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What Copilot Credit Compass collects, what it does not, and the exact JSON that leaves your browser if you choose to contribute to the benchmark.',
};

const card = getRateCard();

/**
 * The literal payload shape, per SPEC §12. This is written out by hand rather
 * than generated from the schema so that a reader can compare it against the
 * network tab character by character. If the schema ever changes and this
 * drifts, the strict parser on the submit route rejects the request — so a
 * mismatch surfaces as a broken submission, not as a silent extra field.
 */
const SAMPLE_PAYLOAD = `{
  "rateCardVersion": "${card.version}",
  "industry": "Financial Services",
  "region": "Northern Europe",
  "employeeBand": "5k-25k",
  "knowledgeWorkerBand": "1k-5k",
  "workloads": ["copilot-studio-agents", "sharepoint-agents"],
  "agentCount": 12,
  "monthlyCreditsExpected": 1045000,
  "monthlyCostExpectedUsd": 105000,
  "creditsPerKnowledgeWorkerPerMonth": 1300,
  "m365CopilotLicensedSharePct": 60,
  "mixClassicPct": 40,
  "mixGenerativePct": 40,
  "mixActionPct": 20,
  "graphGroundingPct": 30,
  "recommendedStrategy": "packs-plus-payg",
  "estimatedAnnualSavingVsPaygUsd": 120000
}`;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line pt-10">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-fg-muted">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
      <header className="mb-10">
        <p className="text-2xs uppercase tracking-[0.18em] text-fg-subtle">Privacy</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          What we collect, in plain English
        </h1>
        <p className="mt-3 text-sm text-fg-muted">
          Short version: your assessment never leaves your browser unless you explicitly choose to
          contribute an anonymous summary to the public benchmark. There is no account, no login, no
          email capture and no analytics profile. This page shows you the exact JSON that would be
          sent if you opt in.
        </p>
      </header>

      <div className="mb-10 grid gap-4 sm:grid-cols-3">
        {[
          ['No account', 'There is nothing to sign up for and no way to identify you.'],
          ['No server storage', 'Your answers live in one browser tab and are discarded with it.'],
          ['No IP logging', 'Rate limiting uses a salted hash that is destroyed every 24 hours.'],
        ].map(([title, body]) => (
          <Card key={title}>
            <CardTitle>{title}</CardTitle>
            <p className="mt-2 text-sm text-fg-muted">{body}</p>
          </Card>
        ))}
      </div>

      <div className="space-y-10">
        <Section id="session" title="Your assessment">
          <p>{SESSION_BANNER}</p>
          <p>
            Concretely: the wizard keeps your answers in memory, mirrored into{' '}
            <code className="rounded bg-bg-raised px-1 py-0.5 text-xs">sessionStorage</code> so that
            navigating between steps or hitting the back button does not lose your work.{' '}
            <code className="rounded bg-bg-raised px-1 py-0.5 text-xs">sessionStorage</code> is
            scoped to a single tab and is cleared by the browser when that tab closes. Nothing is
            written to <code className="rounded bg-bg-raised px-1 py-0.5 text-xs">localStorage</code>
            , to a cookie, or to a server.
          </p>
          <p>
            The calculation runs entirely in your browser. The one exception is generating a PDF,
            XLSX or PPTX export: those are produced on the server because the libraries involved
            cannot run in a browser. Your answers are posted to that endpoint, used to generate the
            file in memory, and returned in the response. They are never written to disk and never
            stored.
          </p>
          <p>
            Because there is no server-side session, we cannot email you your results, recover them
            for you, or tell you what you entered last week. That is a deliberate trade: it is the
            only version of this tool where the privacy claim requires no trust.
          </p>
        </Section>

        <Section id="benchmark" title="If you contribute to the benchmark">
          <p>
            Contribution is optional and off by default. Your results are byte-for-byte identical
            whether you contribute or not — nothing is unlocked, gated or improved by opting in.
          </p>
          <p>This is the complete payload. There are no other fields:</p>
          <pre className="overflow-x-auto rounded-lg border border-line bg-bg-raised p-4 text-xs leading-relaxed">
            <code>{SAMPLE_PAYLOAD}</code>
          </pre>
          <p>
            Note what is absent: no company name, no domain, no email, no user count that is not
            already a band, no free text of any kind, and no identifier that persists between
            submissions. The server adds a random UUID, a timestamp{' '}
            <em>truncated to the hour</em>, and the coarse cohort string used as a database
            partition key. Minute-level timing is dropped precisely because it is a correlation
            risk.
          </p>
          <p>
            Every number in that payload is bucketed <em>before</em> it leaves your browser. A
            credit figure of 1,043,078 is rounded to 1,045,000; a cost of $104,308 becomes $105,000.
            The rounding is coarse enough that the value cannot act as a fingerprint for a
            particular run.
          </p>
        </Section>

        <Section id="k-anonymity" title="Why you cannot be picked out of the benchmark">
          <p>
            The benchmark only ever publishes aggregates, and only once a group is large enough to
            hide inside. The threshold is{' '}
            <Badge tone="accent">n ≥ {card.modelAssumptions.kAnonymityMinimum}</Badge> — no cohort
            with fewer than {card.modelAssumptions.kAnonymityMinimum} contributing organisations is
            rendered, exported or returned by any endpoint.
          </p>
          <p>
            When a cohort is too small, its records are rolled up to a coarser grouping rather than
            published: industry and region and size, then industry and region, then industry alone,
            then the global pool. If a remainder still sits below the threshold at the coarsest
            level, it is not published at all. It still counts towards the total, but nothing
            derived from it is visible.
          </p>
          <p>
            There is no API, export, query parameter or CSV that returns an individual submission.
            The storage adapter itself only exposes insert, count and read-all-for-aggregation — the
            application has no code path that fetches one record by id, because that code path does
            not exist.
          </p>
          <p>
            Submissions with implausible values are silently discarded rather than rejected with an
            explanation. A single extreme outlier can skew a small cohort enough to make an
            individual contributor inferable, and telling a caller exactly which threshold they
            crossed would hand them a way to probe the rules.
          </p>
        </Section>

        <Section id="rate-limiting" title="How rate limiting works without storing IPs">
          <p>
            The benchmark endpoint has to stop one person flooding it with fabricated submissions.
            The usual way to do that is to keep a counter against each IP address. We do not do
            that.
          </p>
          <p>
            Instead the client address is hashed with a random salt that is generated when the
            process starts and regenerated every 24 hours. Only the truncated hash is held, and the
            entire counter map is discarded when the salt rotates. Yesterday&rsquo;s salt no longer
            exists anywhere, so yesterday&rsquo;s hashes cannot be reversed even by someone who
            obtains the running process. No IP address is written to memory beyond the microseconds
            it takes to hash it, and none reaches disk, logs or telemetry.
          </p>
          <p>
            This is deliberately best-effort rather than airtight. A determined attacker running a
            dictionary over the address space against a live process could correlate a hash. That
            residual risk is accepted for a counter whose only job is to keep a public benchmark
            honest, and it is the k-anonymity floor and outlier rejection that do the real work.
          </p>
        </Section>

        <Section id="telemetry" title="Analytics and telemetry">
          <p>
            There are no third-party analytics, no advertising pixels, no session recording and no
            fingerprinting. Nothing on any page loads a script from a domain other than the one
            serving the application.
          </p>
          <p>
            A deployed instance may run Azure Application Insights for operational health — error
            rates, response times, availability. Where it is enabled it is configured to strip the
            client IP field rather than merely masking it, and no custom event carries any value
            from your assessment. If you self-host, that behaviour is set in{' '}
            <code className="rounded bg-bg-raised px-1 py-0.5 text-xs">infra/main.bicep</code> and
            you can inspect it.
          </p>
        </Section>

        <Section id="cookies" title="Cookies">
          <p>
            The application sets no cookies. Your theme preference is kept in{' '}
            <code className="rounded bg-bg-raised px-1 py-0.5 text-xs">localStorage</code> so the
            page does not flash the wrong colour scheme on load; it is a single string, it never
            leaves the device, and clearing site data removes it.
          </p>
        </Section>

        <Section id="rights" title="Data subject rights">
          <p>
            We hold no personal data, so there is nothing to request, correct or erase. If you have
            contributed to the benchmark there is no way for you — or for us — to identify which
            record was yours, which is the point. Nothing in a contributed record constitutes
            personal data under UK GDPR or GDPR: there is no identifier, direct or indirect, from
            which a natural person or an organisation could be singled out.
          </p>
          <p>
            If you believe a specific contributed record should be removed and can describe it, we
            cannot honour the request, because the record cannot be located. If that matters to you,
            do not contribute — the tool works identically either way.
          </p>
        </Section>

        <Section id="verify" title="How to check any of this">
          <p>
            Open your browser&rsquo;s developer tools, go to the Network tab, and complete an
            assessment. You will see no outbound request until you either export a report or
            explicitly opt in to the benchmark. When you do opt in, the request body will match the
            JSON above exactly — the server parses it strictly and returns a 422 if a single
            unexpected field is present, so it cannot quietly accept more than it says it does.
          </p>
          <p>
            The source is available and the relevant files are small:{' '}
            <code className="rounded bg-bg-raised px-1 py-0.5 text-xs">lib/benchmark/record.ts</code>{' '}
            defines everything that may ever be sent,{' '}
            <code className="rounded bg-bg-raised px-1 py-0.5 text-xs">
              lib/benchmark/rate-limit.ts
            </code>{' '}
            is the IP hashing, and{' '}
            <code className="rounded bg-bg-raised px-1 py-0.5 text-xs">
              lib/benchmark/aggregate.ts
            </code>{' '}
            is the k-anonymity roll-up.
          </p>
        </Section>
      </div>

      <footer className="mt-12 border-t border-line pt-6">
        <p className="text-xs leading-relaxed text-fg-subtle">{DISCLAIMER}</p>
        <p className="mt-4 text-sm">
          <Link href="/methodology" className="underline decoration-dotted underline-offset-4">
            Methodology
          </Link>
          {' · '}
          <Link href="/benchmark" className="underline decoration-dotted underline-offset-4">
            Public benchmark
          </Link>
        </p>
      </footer>
    </main>
  );
}
