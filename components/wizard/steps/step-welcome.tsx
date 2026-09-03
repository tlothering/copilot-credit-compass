'use client';

import { getRateCard } from '@/lib/engine/rate-card';
import { Card } from '@/components/ui/primitives';

const card = getRateCard();

export function StepWelcome() {
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-medium tracking-tight">About six minutes, around twenty questions</h2>
        <p className="mt-2 text-sm text-fg-muted">
          You describe what you are deploying in ordinary business language — agents, conversations,
          documents, calls, seats. We convert that into Copilot Credits using rate card{' '}
          <span className="font-mono text-fg">{card.version}</span>, model twelve months of ramped
          consumption, and score eight funding options against your appetite for commitment.
        </p>
        <p className="mt-2 text-sm text-fg-muted">
          Every question has a &ldquo;Skip — use industry default&rdquo; option. Skipping is
          recorded and lowers the confidence rating on your result rather than hiding the gap.
        </p>
      </Card>

      <Card className="border-warn/40 bg-warn-quiet">
        <h2 className="font-medium tracking-tight">
          Your results live in this browser tab and nowhere else
        </h2>
        <p className="mt-2 text-sm text-fg-muted">
          There is no account and no server-side session. If you close or reload this tab before
          exporting, your answers are gone and cannot be recovered — not by you and not by us. We
          will warn you before the tab closes. Export to PDF, Excel or PowerPoint at the end to keep
          anything.
        </p>
      </Card>

      <Card>
        <h2 className="font-medium tracking-tight">What we do and do not collect</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-fg-muted">
          <li>
            <strong className="text-fg">Never:</strong> your name, employer, email, tenant, IP
            address, or any free text. There is no free-text field in this wizard by design.
          </li>
          <li>
            <strong className="text-fg">Only if you opt in at the end:</strong> a coarse,
            banded, anonymous record — industry, region, employee band, workload mix, credits per
            user, and the option we recommended.
          </li>
          <li>
            <strong className="text-fg">Published only in aggregate:</strong> a cohort appears in
            the public benchmark once at least five organisations sit inside it.
          </li>
        </ul>
      </Card>

      <Card>
        <h2 className="font-medium tracking-tight">This is not a Microsoft quotation</h2>
        <p className="mt-2 text-sm text-fg-muted">
          Copilot Credit Compass is an independent planning tool. Rates change, and your agreement
          may carry discounts we know nothing about. Treat the output as a defensible starting point
          for a conversation with your Microsoft account team, not as a price.
        </p>
      </Card>
    </div>
  );
}
