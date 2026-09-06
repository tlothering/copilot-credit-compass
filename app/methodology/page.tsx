import type { Metadata } from 'next';
import Link from 'next/link';
import { getRateCard } from '@/lib/engine/rate-card';
import { Badge, Card, CardTitle } from '@/components/ui/primitives';
import { DISCLAIMER } from '@/lib/export/copy';

export const metadata: Metadata = {
  title: 'Methodology',
  description:
    'Every rate, formula and assumption behind Copilot Credit Compass, with a source link for each number and an honest note where a rate could not be verified.',
};

const card = getRateCard();

function VerifiedChip({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge tone="success">Verified</Badge>
  ) : (
    <Badge tone="warn">Unverified</Badge>
  );
}

function Source({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
    >
      Source
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line pt-10">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {lede ? <p className="mt-2 max-w-2xl text-sm text-fg-muted">{lede}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** A formula rendered as prose plus its literal expression, so it can be checked by hand. */
function Formula({ name, expr, note }: { name: string; expr: string; note?: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg-raised p-4">
      <p className="text-sm font-medium">{name}</p>
      <pre className="mt-2 overflow-x-auto text-xs leading-relaxed text-fg-muted">
        <code>{expr}</code>
      </pre>
      {note ? <p className="mt-2 text-xs text-fg-subtle">{note}</p> : null}
    </div>
  );
}

export default function MethodologyPage() {
  const consumption = Object.entries(card.consumption);
  const unverifiedCount = consumption.filter(([, r]) => !r.verified).length;

  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8">
      <header className="mb-10">
        <p className="text-2xs uppercase tracking-[0.18em] text-fg-subtle">Methodology</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Every number, and where it came from
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-fg-muted">
          This tool is only useful if you can check it. Below is the complete rate card currently
          loaded, every formula the engine applies, and an explicit list of the places where a rate
          could not be confirmed against Microsoft documentation. Your results page carries a full
          audit trail of the same calculations applied to your own inputs.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Badge tone="accent">Rate card {card.version}</Badge>
          <Badge>Effective {card.effectiveDate}</Badge>
          <Badge>{card.currency}</Badge>
          {unverifiedCount > 0 ? (
            <Badge tone="warn">
              {unverifiedCount} rate{unverifiedCount === 1 ? '' : 's'} unverified
            </Badge>
          ) : (
            <Badge tone="success">All rates verified</Badge>
          )}
        </div>
      </header>

      <nav aria-label="On this page" className="mb-10">
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-fg-muted">
          {[
            ['consumption', 'Consumption rates'],
            ['commercial', 'Commercial rates'],
            ['prepurchase', 'Pre-purchase tiers'],
            ['formulas', 'Formulas'],
            ['breakeven', 'Licence-offset break-even'],
            ['funding', 'Funding options'],
            ['assumptions', 'Assumptions'],
            ['limits', 'What this cannot tell you'],
            ['changelog', 'Changelog'],
          ].map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="underline decoration-dotted underline-offset-4">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-10">
        <Section
          id="consumption"
          title="Consumption rates"
          lede="How many credits each metered action costs. These are the multipliers applied to the volumes you enter in the wizard."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <caption className="sr-only">
                Copilot credit consumption rates in rate card {card.version}
              </caption>
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Action
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Credits
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Per
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Licence offset
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Reference
                  </th>
                </tr>
              </thead>
              <tbody>
                {consumption.map(([id, rate]) => (
                  <tr key={id} className="border-b border-line/60 align-top">
                    <th scope="row" className="py-3 pr-3 text-left font-normal">
                      <span className="font-medium">{rate.label}</span>
                      <span className="mt-0.5 block font-mono text-2xs text-fg-subtle">{id}</span>
                      {rate.note ? (
                        <span className="mt-1 block text-xs text-fg-muted">{rate.note}</span>
                      ) : null}
                    </th>
                    <td className="py-3 pr-3 text-right tabular-nums">
                      {rate.credits.toLocaleString('en-GB')}
                    </td>
                    <td className="py-3 pr-3 text-fg-muted">{rate.unit}</td>
                    <td className="py-3 pr-3 text-fg-muted">
                      {rate.offsetByM365CopilotLicence ? 'Yes' : 'No'}
                    </td>
                    <td className="py-3 pr-3">
                      <VerifiedChip verified={rate.verified} />
                    </td>
                    <td className="py-3">
                      <Source href={rate.sourceUrl} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-fg-subtle">
            &ldquo;Licence offset&rdquo; means the action is included for a user who holds a
            Microsoft 365 Copilot licence and therefore consumes no credits for that user. This is
            the mechanism behind the break-even analysis below.
          </p>
        </Section>

        <Section
          id="commercial"
          title="Commercial rates"
          lede="What a credit costs, and what the alternatives to buying credits cost."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardTitle>Pay-as-you-go</CardTitle>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                ${card.commercial.paygCreditUsd.value.toFixed(2)}
                <span className="ml-1 text-sm font-normal text-fg-muted">
                  / {card.commercial.paygCreditUsd.unit}
                </span>
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs">
                <VerifiedChip verified={card.commercial.paygCreditUsd.verified} />
                <Source href={card.commercial.paygCreditUsd.sourceUrl} />
              </div>
            </Card>

            <Card>
              <CardTitle>{card.commercial.capacityPack.label}</CardTitle>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                ${card.commercial.capacityPack.monthlyUsd.toLocaleString('en-GB')}
                <span className="ml-1 text-sm font-normal text-fg-muted">/ month</span>
              </p>
              <p className="mt-1 text-sm text-fg-muted">
                {card.commercial.capacityPack.credits.toLocaleString('en-GB')} credits, effective $
                {card.commercial.capacityPack.effectiveUsdPerCredit.toFixed(2)} per credit.
              </p>
              <p className="mt-2 text-xs text-fg-subtle">
                {card.commercial.capacityPack.rollsOver
                  ? 'Unused credits roll over.'
                  : 'Unused credits do not roll over.'}{' '}
                Resets on day {card.commercial.capacityPack.resetDayOfMonth} of the month — this is
                why the model penalises a pack that is only partly consumed.
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs">
                <VerifiedChip verified={card.commercial.capacityPack.verified} />
                <Source href={card.commercial.capacityPack.sourceUrl} />
              </div>
            </Card>

            <Card>
              <CardTitle>{card.commercial.m365CopilotSeatMonthlyUsd.label}</CardTitle>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                ${card.commercial.m365CopilotSeatMonthlyUsd.value.toFixed(2)}
                <span className="ml-1 text-sm font-normal text-fg-muted">
                  / {card.commercial.m365CopilotSeatMonthlyUsd.unit}
                </span>
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs">
                <VerifiedChip verified={card.commercial.m365CopilotSeatMonthlyUsd.verified} />
                <Source href={card.commercial.m365CopilotSeatMonthlyUsd.sourceUrl} />
              </div>
            </Card>

            <Card>
              <CardTitle>{card.commercial.securityCopilot.label}</CardTitle>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                ${card.commercial.securityCopilot.provisionedScuHourUsd.toFixed(2)}
                <span className="ml-1 text-sm font-normal text-fg-muted">/ SCU hour</span>
              </p>
              <p className="mt-1 text-sm text-fg-muted">
                Overage ${card.commercial.securityCopilot.overageScuHourUsd.toFixed(2)} per SCU
                hour. Minimum {card.commercial.securityCopilot.minimumScu} SCU.
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs">
                <VerifiedChip verified={card.commercial.securityCopilot.verified} />
                <Source href={card.commercial.securityCopilot.sourceUrl} />
              </div>
            </Card>

            <Card>
              <CardTitle>{card.commercial.githubCopilot.label}</CardTitle>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                ${card.commercial.githubCopilot.plans.business.seatMonthlyUsd.toFixed(2)}
                <span className="ml-1 text-sm font-normal text-fg-muted">/ seat / month</span>
              </p>
              <p className="mt-1 text-sm text-fg-muted">
                Business includes{' '}
                {card.commercial.githubCopilot.plans.business.includedAiCreditsPerUserPerMonth.toLocaleString(
                  'en-GB',
                )}{' '}
                AI credits per user per month. Enterprise $
                {card.commercial.githubCopilot.plans.enterprise.seatMonthlyUsd.toFixed(2)} with{' '}
                {card.commercial.githubCopilot.plans.enterprise.includedAiCreditsPerUserPerMonth.toLocaleString(
                  'en-GB',
                )}
                . Overage ${card.commercial.githubCopilot.overageCreditUsd.toFixed(2)} per AI
                credit, enabled by default.
              </p>
              <p className="mt-3 rounded-lg bg-accent-soft/60 px-3 py-2 text-sm text-fg">
                <strong className="font-semibold">
                  Code completions and next edit suggestions are unlimited and never billed
                </strong>{' '}
                on a paid plan. Only {card.commercial.githubCopilot.billedFeatures.join(', ')} draw
                AI credits — so most developers never generate any overage at all.
              </p>
              <ul className="mt-3 space-y-1 text-sm text-fg-muted">
                <li>
                  Allowances are pooled across the {card.commercial.githubCopilot.poolScope}, not
                  ring-fenced per user, so heavy users draw on quieter colleagues&rsquo; share
                  before anyone pays overage.
                </li>
                <li>
                  {card.commercial.githubCopilot.creditsRollOver
                    ? 'Unused credits roll over.'
                    : 'Unused credits do not roll over.'}{' '}
                  The pool resets on day {card.commercial.githubCopilot.poolResetDayOfMonth} at{' '}
                  {card.commercial.githubCopilot.poolResetTimeUtc} UTC.
                </li>
                <li>
                  {card.commercial.githubCopilot.automaticFallbackToCheaperModel
                    ? 'Requests fall back to a cheaper model once the pool is exhausted.'
                    : 'There is no automatic fallback to a cheaper model once the pool is exhausted — spend simply continues at the overage rate.'}{' '}
                  {card.commercial.githubCopilot.userLevelBudgetsCanHaltIndividual
                    ? 'User-level budgets can halt an individual.'
                    : ''}
                </li>
                {card.commercial.githubCopilot.promotionalAllowance.expired ? (
                  <li>
                    Remembering a bigger number? The launch promotion (
                    {card.commercial.githubCopilot.promotionalAllowance.business.toLocaleString(
                      'en-GB',
                    )}{' '}
                    Business /{' '}
                    {card.commercial.githubCopilot.promotionalAllowance.enterprise.toLocaleString(
                      'en-GB',
                    )}{' '}
                    Enterprise) ran to{' '}
                    {card.commercial.githubCopilot.promotionalAllowance.endDate} and has expired.
                  </li>
                ) : null}
                <li>
                  <strong className="font-medium text-fg">
                    These are GitHub AI credits, not Microsoft Copilot Credits.
                  </strong>{' '}
                  They bill on GitHub&rsquo;s own meter. This tool keeps the two pools apart and
                  never adds them together, because no Microsoft purchasing vehicle — capacity
                  pack, pre-purchase tier, MACC burn-down or Azure prepayment — can fund a GitHub
                  bill. Any GitHub overage is therefore charged identically under every funding
                  option, so it never changes which option we recommend.
                </li>
              </ul>
              <div className="mt-3 flex items-center gap-2 text-xs">
                <VerifiedChip verified={card.commercial.githubCopilot.verified} />
                <Source href={card.commercial.githubCopilot.sourceUrl} />
              </div>
            </Card>

            <Card>
              <CardTitle>{card.commercial.foundry.label}</CardTitle>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                ${card.commercial.foundry.inputPerMillionTokensUsd.toFixed(2)}
                <span className="ml-1 text-sm font-normal text-fg-muted">/ 1M input tokens</span>
              </p>
              <p className="mt-1 text-sm text-fg-muted">
                ${card.commercial.foundry.outputPerMillionTokensUsd.toFixed(2)} per 1M output
                tokens.
              </p>
              {card.commercial.foundry.note ? (
                <p className="mt-2 text-xs text-fg-muted">{card.commercial.foundry.note}</p>
              ) : null}
              <div className="mt-3 flex items-center gap-2 text-xs">
                <VerifiedChip verified={card.commercial.foundry.verified} />
                <Source href={card.commercial.foundry.sourceUrl} />
              </div>
            </Card>
          </div>
        </Section>

        <Section
          id="prepurchase"
          title={card.p3PrePurchasePlan.label}
          lede={`A ${card.p3PrePurchasePlan.termMonths}-month commitment bought up front in exchange for a discount. ${
            card.p3PrePurchasePlan.cancellable ? 'Cancellable.' : 'Not cancellable once placed.'
          }`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <caption className="sr-only">Pre-purchase plan discount tiers</caption>
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Tier
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Commit units
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Discount
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Effective $/credit
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {card.p3PrePurchasePlan.tiers.map((t) => (
                  <tr key={t.commitUnits} className="border-b border-line/60">
                    <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                      Tier {(t.discountPct * 100).toFixed(0)}%
                    </th>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {t.commitUnits.toLocaleString('en-GB')}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {(t.discountPct * 100).toFixed(1)}%
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      $
                      {(card.commercial.paygCreditUsd.value * (1 - t.discountPct)).toFixed(4)}
                    </td>
                    <td className="py-2.5 text-right">
                      <VerifiedChip verified={t.verified} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-fg-subtle">
            One commit unit is billed at $
            {card.p3PrePurchasePlan.usdRetailPaidDownPerCommitUnit.toLocaleString('en-GB')} of
            retail paid down. <Source href={card.p3PrePurchasePlan.sourceUrl} />
          </p>
        </Section>

        <Section
          id="formulas"
          title="Formulas"
          lede="The engine is a pure function: the same answers always produce the same result, and every step below appears in your audit trail with its inputs and output."
        >
          <div className="space-y-3">
            <Formula
              name="1. Monthly volume per line"
              expr={`quantity = usersOrItems x frequencyPerUserPerMonth x seasonalityFactor
internalVolume  = quantity x internalSharePct
licensedVolume  = internalVolume x licensedShareOfInternalPct`}
              note="Splitting internal from external matters because only internal, licensed users can be offset by a Microsoft 365 Copilot licence."
            />
            <Formula
              name="2. Gross credits"
              expr={`grossCredits = SUM over lines of ( quantity x creditsPerUnit )`}
            />
            <Formula
              name="3. Offset and billable credits"
              expr={`offsetCredits   = SUM over offset-eligible lines of ( grossCredits x offsetShare )
billableCredits = grossCredits - offsetCredits`}
              note="offsetShare is the proportion of that line's volume attributable to internal users who hold a Microsoft 365 Copilot licence."
            />
            <Formula
              name="4. Metered cost"
              expr={`meteredCreditCostUsd = billableCredits x effectiveUsdPerCredit`}
              note="effectiveUsdPerCredit depends on the funding option being priced — pay-as-you-go, the capacity pack rate, or a pre-purchase tier rate."
            />
            <Formula
              name="5. Scenario band"
              expr={`low      = expected x (1 - coefficientOfVariation)
expected = billableCredits
high     = expected x (1 + coefficientOfVariation)`}
              note="The coefficient of variation is derived from how much of your volume comes from uncertain sources — new agents, unproven adoption assumptions and autonomous actions widen the band."
            />
            <Formula
              name="6. Capacity pack sizing"
              expr={`packsNeeded = CEILING( creditsForTheMonth / creditsPerPack )
wastage     = ( packsNeeded x creditsPerPack ) - creditsForTheMonth`}
              note="Packs are whole units and do not roll over, so a workload that is lumpy month to month pays for the peak every month."
            />
          </div>
        </Section>

        <Section
          id="breakeven"
          title="Microsoft 365 Copilot licence-offset break-even"
          lede="The single most consequential calculation in the tool: at what level of individual usage does buying someone a licence cost less than paying for the credits they would otherwise consume?"
        >
          <div className="space-y-3">
            <Formula
              name="Break-even credits per user per month"
              expr={`breakEvenCredits = m365CopilotSeatMonthlyUsd / usdPerCredit

Pay-as-you-go: $${card.commercial.m365CopilotSeatMonthlyUsd.value.toFixed(
                2,
              )} / $${card.commercial.paygCreditUsd.value.toFixed(2)} = ${Math.round(
                card.commercial.m365CopilotSeatMonthlyUsd.value /
                  card.commercial.paygCreditUsd.value,
              ).toLocaleString('en-GB')} credits
Capacity pack: $${card.commercial.m365CopilotSeatMonthlyUsd.value.toFixed(
                2,
              )} / $${card.commercial.capacityPack.effectiveUsdPerCredit.toFixed(2)} = ${Math.round(
                card.commercial.m365CopilotSeatMonthlyUsd.value /
                  card.commercial.capacityPack.effectiveUsdPerCredit,
              ).toLocaleString('en-GB')} credits`}
              note="Two thresholds, because the credits you avoid are priced at whatever you would otherwise have paid for them. If you are already buying capacity packs the licence has to clear a higher bar."
            />
            <Formula
              name="Users above the line"
              expr={`perUserCredits    = offsetEligibleCredits / internalUsers
usersAboveTheLine = COUNT of unlicensed internal users whose modelled
                    consumption exceeds breakEvenCredits`}
              note="The engine models a lognormal spread of usage across your population rather than assuming everyone consumes the average, because heavy-user concentration is precisely what makes this decision non-obvious."
            />
            <Formula
              name="Net effect of licensing those users"
              expr={`creditSavingUsd = creditsAvoided x usdPerCredit
licenceCostUsd  = usersToLicense x m365CopilotSeatMonthlyUsd
netMonthlyUsd   = licenceCostUsd - creditSavingUsd`}
              note="A negative net is a saving. The recommendation only proposes a licence shift where the saving survives the low end of the scenario band."
            />
          </div>
          <p className="mt-4 text-sm text-fg-muted">
            A licence buys more than credit avoidance — it also buys the in-app Copilot experience
            across Word, Excel, Outlook and Teams. The engine deliberately does not attempt to price
            that, because doing so would require inventing a productivity number. Treat the
            break-even as a floor: if someone is already above it on credit consumption alone, the
            licence pays for itself before you count anything else.
          </p>
        </Section>

        <Section
          id="funding"
          title="The eight funding options"
          lede="All eight are always computed and always shown, including the ones that are wrong for you. An option you can see rejected is more trustworthy than an option that was quietly filtered out."
        >
          <ol className="space-y-3 text-sm">
            {[
              ['Pay-as-you-go only', 'No commitment, highest unit price, perfectly elastic.'],
              [
                'Capacity packs only',
                'Lowest unit price on the credits you actually use, but you pay for the peak every month and unused credits expire.',
              ],
              [
                'Packs plus pay-as-you-go overflow',
                'Packs sized to the trough, overflow metered. Usually the sensible default once volume is predictable.',
              ],
              [
                'Pre-purchase plan plus pay-as-you-go',
                'Discount in exchange for a term commitment, with metered overflow above it.',
              ],
              [
                'Pre-purchase plus packs plus pay-as-you-go',
                'The full layered structure. Cheapest at scale, most operational overhead.',
              ],
              [
                'Microsoft 365 Copilot licence shift',
                'Buy licences for the heaviest users and stop paying for their credits entirely.',
              ],
              [
                'Bring your own model via Azure AI Foundry',
                'Move suitable workloads onto Azure consumption, which may draw down an existing commitment.',
              ],
              [
                'Do nothing',
                'Included deliberately. Sometimes the honest answer is that the volume does not yet justify changing anything.',
              ],
            ].map(([name, why]) => (
              <li key={name} className="rounded-lg border border-line bg-bg-raised p-4">
                <p className="font-medium">{name}</p>
                <p className="mt-1 text-fg-muted">{why}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-fg-muted">
            Each option is scored on twelve-month total cost, then adjusted for reversibility and
            operational burden. Where two options land within a few percent of each other the
            recommendation says so rather than manufacturing a false winner.
          </p>
        </Section>

        <Section
          id="assumptions"
          title="Assumptions"
          lede="The values the model uses when you have not told it otherwise. All of them live in the rate card and can be changed without touching code."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <caption className="sr-only">Model assumptions</caption>
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Assumption
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(card.modelAssumptions).map(([key, value]) => (
                  <tr key={key} className="border-b border-line/60">
                    <th scope="row" className="py-2.5 pr-3 text-left font-normal font-mono text-xs">
                      {key}
                    </th>
                    <td className="py-2.5 text-right tabular-nums">
                      {typeof value === 'number' ? value.toLocaleString('en-GB') : String(value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          id="limits"
          title="What this cannot tell you"
          lede="Being clear about the boundary is part of being useful inside it."
        >
          <ul className="space-y-2 text-sm text-fg-muted">
            <li>
              It cannot tell you what you will actually consume. It tells you what the volumes you
              entered would cost if they turn out to be right.
            </li>
            <li>
              It does not know your negotiated terms. Enterprise agreements, partner arrangements
              and regional pricing all move these numbers.
            </li>
            <li>
              It does not model the productivity value of any of this. Every figure here is a cost,
              not a return.
            </li>
            <li>
              It does not account for credits consumed by workloads not listed in the wizard, nor by
              experimentation and failed agent runs, which in early deployments are frequently the
              largest single line.
            </li>
            <li>
              Rates change. The card is stamped {card.version}, effective {card.effectiveDate}. If
              that date is old relative to when you are reading this, treat the output as
              directional and re-check the sources above.
            </li>
          </ul>
        </Section>

        <Section
          id="changelog"
          title="Rate card changelog"
          lede="Every published version of the rate card and what moved."
        >
          <ol className="space-y-3 text-sm">
            {(card.changelog ?? []).map((entry) => (
              <li key={entry.version} className="rounded-lg border border-line bg-bg-raised p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{entry.version}</Badge>
                  <span className="text-xs text-fg-subtle">{entry.date}</span>
                </div>
                <p className="mt-2 text-fg-muted">{entry.summary}</p>
              </li>
            ))}
          </ol>
        </Section>
      </div>

      <footer className="mt-12 border-t border-line pt-6">
        <p className="text-xs leading-relaxed text-fg-subtle">{DISCLAIMER}</p>
        <p className="mt-4 text-sm">
          <Link href="/privacy" className="underline decoration-dotted underline-offset-4">
            What we collect
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
