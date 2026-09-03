'use client';

import { useSession } from '@/lib/store/session';
import { defaultAnswers } from '@/lib/schemas/answers';
import { BUDGET_TOLERANCES, CONFIDENCE_LEVELS } from '@/lib/schemas/taxonomy';
import { Card } from '@/components/ui/primitives';
import { FieldShell, NumberField, PercentSlider, RadioCards, ToggleField, toOptions } from '../fields';

const DEFAULTS = defaultAnswers().growth;

const RAMP_FIELDS = [
  { key: 'rampMonth1Pct', label: 'Month 1' },
  { key: 'rampMonth3Pct', label: 'Month 3' },
  { key: 'rampMonth6Pct', label: 'Month 6' },
  { key: 'rampMonth12Pct', label: 'Month 12' },
] as const;

const CONFIDENCE_DESC: Record<(typeof CONFIDENCE_LEVELS)[number], string> = {
  low: 'Widest band. Conservative and aggressive sit far apart, and prepaid options are penalised.',
  medium: 'Balanced band. The default for most planning exercises.',
  high: 'Narrow band. Only choose this if you have telemetry from a real pilot.',
};

const TOLERANCE_DESC: Record<(typeof BUDGET_TOLERANCES)[number], string> = {
  never: 'A surprise overage is unacceptable. Favours capped and prepaid structures.',
  tolerable: 'An occasional overage is survivable if the average is right.',
  irrelevant: 'Cost variance does not matter. Favours pure pay-as-you-go flexibility.',
};

export function StepGrowth() {
  const growth = useSession((s) => s.answers.growth);
  const setGrowth = useSession((s) => s.setGrowth);
  const touched = useSession((s) => s.touched);
  const isSkipped = (k: keyof typeof DEFAULTS) => !touched.includes(`growth.${k}`);
  const skip = (k: keyof typeof DEFAULTS) => () =>
    setGrowth({ [k]: DEFAULTS[k] } as Partial<typeof growth>);

  const monotonic =
    growth.rampMonth1Pct <= growth.rampMonth3Pct &&
    growth.rampMonth3Pct <= growth.rampMonth6Pct &&
    growth.rampMonth6Pct <= growth.rampMonth12Pct;

  return (
    <div className="space-y-4">
      <Card>
        <FieldShell
          label="Adoption ramp — share of steady-state volume reached by each month"
          why="Almost nobody hits full volume on day one. The ramp decides how much of the annual cost actually lands this year."
          effect="Very large on the twelve-month total, and it drives the volatility measure that penalises rigid prepaid commitments."
          error={
            monotonic ? undefined : 'Each milestone should be at least as high as the one before it.'
          }
          onSkip={() => setGrowth({
            rampMonth1Pct: DEFAULTS.rampMonth1Pct,
            rampMonth3Pct: DEFAULTS.rampMonth3Pct,
            rampMonth6Pct: DEFAULTS.rampMonth6Pct,
            rampMonth12Pct: DEFAULTS.rampMonth12Pct,
          })}
        >
          <div className="space-y-3">
            {RAMP_FIELDS.map((f) => (
              <div key={f.key} className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
                <label htmlFor={f.key} className="text-sm text-fg-muted">
                  {f.label}
                </label>
                <PercentSlider
                  id={f.key}
                  value={growth[f.key]}
                  onChange={(v) => setGrowth({ [f.key]: v })}
                />
              </div>
            ))}
          </div>
        </FieldShell>
      </Card>

      <Card className="space-y-5">
        <FieldShell
          label="How confident are you in the numbers you just gave us?"
          why="Your own confidence is the only honest basis for the width of a scenario band. We refuse to invent a false precision."
          effect="Sets the spread between the conservative and aggressive bands, and how heavily volatility is penalised in scoring."
          onSkip={skip('confidence')}
          skipped={isSkipped('confidence')}
        >
          <RadioCards
            name="Confidence"
            columns={3}
            value={growth.confidence}
            options={toOptions(
              CONFIDENCE_LEVELS,
              (v) => v[0]!.toUpperCase() + v.slice(1),
              (v) => CONFIDENCE_DESC[v],
            )}
            onChange={(confidence) => setGrowth({ confidence })}
          />
        </FieldShell>

        <FieldShell
          label="Is a surprise overage acceptable?"
          why="Two organisations with identical consumption should be funded differently if one cannot tolerate a variance."
          effect="Directly reweights the scoring. 'Never' pushes towards prepaid and capped structures even at a higher expected total."
          onSkip={skip('budgetTolerance')}
          skipped={isSkipped('budgetTolerance')}
        >
          <RadioCards
            name="Budget tolerance"
            columns={3}
            value={growth.budgetTolerance}
            options={toOptions(
              BUDGET_TOLERANCES,
              (v) => v[0]!.toUpperCase() + v.slice(1),
              (v) => TOLERANCE_DESC[v],
            )}
            onChange={(budgetTolerance) => setGrowth({ budgetTolerance })}
          />
        </FieldShell>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-medium">Governance and procurement</h2>
        <ToggleField
          id="costAttributionPerBu"
          checked={growth.costAttributionPerBu}
          onChange={(costAttributionPerBu) => setGrowth({ costAttributionPerBu })}
          label="We need cost attribution per business unit"
          desc="Triggers a billing-policy and chargeback recommendation in the governance actions."
        />
        <ToggleField
          id="canCommitAnnually"
          checked={growth.canCommitAnnually}
          onChange={(canCommitAnnually) => setGrowth({ canCommitAnnually })}
          label="We can commit to an annual purchase"
          desc="Required for prepaid capacity. Without it, several funding options are ineligible."
        />
        <ToggleField
          id="hasUnspentAzureCommitment"
          checked={growth.hasUnspentAzureCommitment}
          onChange={(hasUnspentAzureCommitment) => setGrowth({ hasUnspentAzureCommitment })}
          label="We have unspent Azure commitment to burn down"
          desc="Makes MACC-eligible options materially more attractive because the money is already spent."
        />
        {growth.hasUnspentAzureCommitment ? (
          <FieldShell
            label="Commitment expires within"
            htmlFor="commitmentExpiringWithinMonths"
            why="Money that expires unspent is money lost, which changes the urgency calculus entirely."
            effect="A short runway raises the priority of options that consume commitment quickly."
          >
            <NumberField
              id="commitmentExpiringWithinMonths"
              value={growth.commitmentExpiringWithinMonths ?? 12}
              min={0}
              max={60}
              suffix="months"
              onChange={(commitmentExpiringWithinMonths) =>
                setGrowth({ commitmentExpiringWithinMonths })
              }
            />
          </FieldShell>
        ) : null}
      </Card>
    </div>
  );
}
