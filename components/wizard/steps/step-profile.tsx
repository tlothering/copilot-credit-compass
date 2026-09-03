'use client';

import { useSession } from '@/lib/store/session';
import { defaultAnswers } from '@/lib/schemas/answers';
import {
  AZURE_AGREEMENTS,
  EMPLOYEE_BANDS,
  INDUSTRIES,
  M365_BASE_PLANS,
  MACC_BANDS,
  REGIONS,
  bandFromCount,
} from '@/lib/schemas/taxonomy';
import { Card } from '@/components/ui/primitives';
import {
  FieldShell,
  NumberField,
  RadioCards,
  SelectField,
  toOptions,
} from '../fields';

const DEFAULTS = defaultAnswers().profile;

const AGREEMENT_LABELS: Record<(typeof AZURE_AGREEMENTS)[number], string> = {
  none: 'No Azure agreement',
  payg: 'Azure pay-as-you-go',
  'ea-mca': 'Enterprise Agreement or MCA',
  macc: 'MACC — Azure consumption commitment',
};

const AGREEMENT_DESCS: Record<(typeof AZURE_AGREEMENTS)[number], string> = {
  none: 'Rules out anything that draws down Azure commitment.',
  payg: 'Eligible for pay-as-you-go credit billing.',
  'ea-mca': 'Opens up prepaid capacity and annual commitment options.',
  macc: 'Unspent commitment can absorb eligible Copilot spend.',
};

export function StepProfile() {
  const profile = useSession((s) => s.answers.profile);
  const setProfile = useSession((s) => s.setProfile);
  const touched = useSession((s) => s.touched);
  const isSkipped = (k: keyof typeof DEFAULTS) => !touched.includes(`profile.${k}`);

  const skip = (k: keyof typeof DEFAULTS) => () =>
    setProfile({ [k]: DEFAULTS[k] } as Partial<typeof profile>);

  const derivedBand = bandFromCount(profile.knowledgeWorkers);

  return (
    <div className="space-y-4">
      <Card className="space-y-5">
        <FieldShell
          label="Industry"
          htmlFor="industry"
          why="Industry sets the default consumption intensity when you skip a usage question, and places you in the right benchmark cohort."
          effect="Changes only the defaults and your cohort. It never applies a hidden multiplier to answers you give explicitly."
          onSkip={skip('industry')}
          skipped={isSkipped('industry')}
        >
          <SelectField
            id="industry"
            value={profile.industry}
            options={toOptions(INDUSTRIES)}
            onChange={(industry) => setProfile({ industry })}
          />
        </FieldShell>

        <FieldShell
          label="Primary region"
          htmlFor="region"
          why="Region determines your benchmark cohort and flags where data-residency or sovereign-cloud constraints may narrow your funding options."
          effect="No direct price effect in this model — the seeded rate card is USD list. Regional list prices differ; confirm with your account team."
          onSkip={skip('region')}
          skipped={isSkipped('region')}
        >
          <SelectField
            id="region"
            value={profile.region}
            options={toOptions(REGIONS)}
            onChange={(region) => setProfile({ region })}
          />
        </FieldShell>
      </Card>

      <Card className="space-y-5">
        <FieldShell
          label="Total employees"
          why="Organisation size is the strongest single predictor of credit demand and is the primary benchmark cohort key."
          effect="Used for banding and benchmarking only. Knowledge workers below is what actually drives volume."
          onSkip={skip('employeeBand')}
          skipped={isSkipped('employeeBand')}
        >
          <RadioCards
            name="Total employees"
            columns={3}
            value={profile.employeeBand}
            options={toOptions(EMPLOYEE_BANDS)}
            onChange={(employeeBand) => setProfile({ employeeBand })}
          />
        </FieldShell>

        <FieldShell
          label="Knowledge workers in scope"
          htmlFor="knowledgeWorkers"
          why="This is the population that could plausibly touch Copilot. It caps how many internal users any single workload can reach."
          effect="Directly bounds internal user counts, which drives the licence-offset break-even and therefore the licence-shift funding option."
          hint={`Equivalent band: ${derivedBand}. This must not exceed your total headcount.`}
          onSkip={skip('knowledgeWorkers')}
          skipped={isSkipped('knowledgeWorkers')}
        >
          <NumberField
            id="knowledgeWorkers"
            value={profile.knowledgeWorkers}
            min={0}
            max={5_000_000}
            step={50}
            suffix="people"
            onChange={(knowledgeWorkers) => setProfile({ knowledgeWorkers })}
          />
        </FieldShell>
      </Card>

      <Card className="space-y-5">
        <FieldShell
          label="Existing Azure agreement"
          why="Prepaid capacity, annual commitment and MACC drawdown are all gated on your commercial agreement."
          effect="Large. Without an EA/MCA or MACC, several funding options are ruled ineligible outright and the recommendation changes."
          onSkip={skip('azureAgreement')}
          skipped={isSkipped('azureAgreement')}
        >
          <RadioCards
            name="Azure agreement"
            columns={2}
            value={profile.azureAgreement}
            options={toOptions(
              AZURE_AGREEMENTS,
              (v) => AGREEMENT_LABELS[v],
              (v) => AGREEMENT_DESCS[v],
            )}
            onChange={(azureAgreement) => setProfile({ azureAgreement })}
          />
        </FieldShell>

        {profile.azureAgreement === 'macc' ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <FieldShell
              label="Remaining commitment"
              htmlFor="maccRemainingBand"
              why="How much unspent Azure commitment you hold determines whether Copilot spend can be absorbed rather than newly funded."
              effect="A large unspent balance makes MACC-eligible options materially cheaper in cash terms and improves their score."
            >
              <SelectField
                id="maccRemainingBand"
                value={profile.maccRemainingBand ?? '<100k'}
                options={toOptions(MACC_BANDS, (v) => `USD ${v}`)}
                onChange={(maccRemainingBand) => setProfile({ maccRemainingBand })}
              />
            </FieldShell>

            <FieldShell
              label="Months remaining on the commitment"
              htmlFor="maccMonthsRemaining"
              why="Commitment expiring inside the planning horizon creates urgency — and risk if you cannot consume it in time."
              effect="Short runway raises the priority of options that burn commitment down quickly."
            >
              <NumberField
                id="maccMonthsRemaining"
                value={profile.maccMonthsRemaining ?? 12}
                min={0}
                max={60}
                suffix="months"
                onChange={(maccMonthsRemaining) => setProfile({ maccMonthsRemaining })}
              />
            </FieldShell>
          </div>
        ) : null}
      </Card>

      <Card>
        <FieldShell
          label="Current Microsoft 365 base plan"
          htmlFor="m365Base"
          why="Your base plan sets the floor for what Copilot can ground on, and whether a Microsoft 365 Copilot add-on is even purchasable."
          effect="Indirect. It contextualises the licence-shift option — the $30 add-on assumes a qualifying base."
          onSkip={skip('m365Base')}
          skipped={isSkipped('m365Base')}
        >
          <SelectField
            id="m365Base"
            value={profile.m365Base}
            options={toOptions(M365_BASE_PLANS)}
            onChange={(m365Base) => setProfile({ m365Base })}
          />
        </FieldShell>
      </Card>
    </div>
  );
}
