import type { RateCard } from './types';
import type { ConsumptionRateId, NormalisedAnswers, VolumeLine, VolumeModel } from './types';
import { externalShareOf } from './normalise';
import { consumptionRate } from './rate-card';
import type { AuditTrail } from './util';
import { clamp } from './util';

interface LineDraft {
  lineId: string;
  label: string;
  quantity: number;
  rateId: ConsumptionRateId;
  internalShare: number;
  licensedShareOfInternal: number;
  formula: string;
  inputs: Record<string, number | string | boolean>;
}

/**
 * Converts business-language answers into monthly steady-state volume in each rate's
 * own unit. "Steady state" means the mature month-12 run rate; the adoption ramp scales
 * it back for earlier months in the scenario model.
 */
export function buildVolumeModel(
  normalised: NormalisedAnswers,
  card: RateCard,
  audit: AuditTrail,
): VolumeModel {
  const { answers } = normalised;
  const usage = answers.usage;
  const assumptions = card.modelAssumptions;
  const lines: VolumeLine[] = [];
  const totalsByWorkload: Record<string, number> = {};

  const push = (workloadId: VolumeLine['workloadId'], draft: LineDraft) => {
    const rate = consumptionRate(card, draft.rateId);
    const quantity = Math.max(0, draft.quantity);
    lines.push({
      workloadId,
      lineId: draft.lineId,
      label: draft.label,
      quantity,
      unit: rate.unit,
      rateId: draft.rateId,
      internalShare: clamp(draft.internalShare, 0, 1),
      licensedShareOfInternal: clamp(draft.licensedShareOfInternal, 0, 1),
    });
    totalsByWorkload[workloadId] = (totalsByWorkload[workloadId] ?? 0) + quantity;
    audit.record(
      `volume:${draft.lineId}`,
      draft.formula,
      draft.inputs,
      quantity,
      rate.unit,
      `consumption.${draft.rateId}`,
    );
  };

  /* ---------------- Copilot Studio custom agents ---------------- */
  const studio = usage['copilot-studio-agents'];
  if (studio) {
    const agents = studio.agents12m;
    const externalShare = externalShareOf(studio.audience, studio.externalTrafficPct);
    const internalShare = 1 - externalShare;
    const licensed = studio.m365CopilotLicensedPct / 100;
    const conversations = agents * studio.conversationsPerAgentPerDay * studio.businessDaysPerMonth;
    const turns = conversations * studio.turnsPerConversation;

    audit.record(
      'volume:copilot-studio-agents:conversations',
      'conversations = agents(12m) × conversationsPerAgentPerDay × businessDaysPerMonth',
      {
        agents,
        conversationsPerAgentPerDay: studio.conversationsPerAgentPerDay,
        businessDaysPerMonth: studio.businessDaysPerMonth,
      },
      conversations,
      'conversations/month',
    );
    audit.record(
      'volume:copilot-studio-agents:turns',
      'turns = conversations × turnsPerConversation',
      { conversations, turnsPerConversation: studio.turnsPerConversation },
      turns,
      'turns/month',
    );

    push('copilot-studio-agents', {
      lineId: 'copilot-studio-agents:classic',
      label: 'Custom agents — classic answers',
      quantity: turns * (studio.mixClassicPct / 100),
      rateId: 'classic-answer',
      internalShare,
      licensedShareOfInternal: licensed,
      formula: 'classicAnswers = turns × mixClassicPct ÷ 100',
      inputs: { turns, mixClassicPct: studio.mixClassicPct },
    });
    push('copilot-studio-agents', {
      lineId: 'copilot-studio-agents:generative',
      label: 'Custom agents — generative answers',
      quantity: turns * (studio.mixGenerativePct / 100),
      rateId: 'generative-answer',
      internalShare,
      licensedShareOfInternal: licensed,
      formula: 'generativeAnswers = turns × mixGenerativePct ÷ 100',
      inputs: { turns, mixGenerativePct: studio.mixGenerativePct },
    });
    push('copilot-studio-agents', {
      lineId: 'copilot-studio-agents:actions',
      label: 'Custom agents — agent actions',
      quantity: turns * (studio.mixActionPct / 100),
      rateId: 'agent-action',
      internalShare,
      licensedShareOfInternal: licensed,
      formula: 'agentActions = turns × mixActionPct ÷ 100',
      inputs: { turns, mixActionPct: studio.mixActionPct },
    });
    push('copilot-studio-agents', {
      lineId: 'copilot-studio-agents:grounding',
      label: 'Custom agents — tenant Graph grounding',
      quantity: turns * (studio.graphGroundingPct / 100),
      rateId: 'tenant-graph-grounding',
      internalShare,
      licensedShareOfInternal: licensed,
      formula: 'groundedMessages = turns × graphGroundingPct ÷ 100',
      inputs: { turns, graphGroundingPct: studio.graphGroundingPct },
    });
    push('copilot-studio-agents', {
      lineId: 'copilot-studio-agents:flow-actions',
      label: 'Custom agents — agent flow actions',
      quantity: studio.triggersFlows ? conversations * studio.flowActionsPerConversation : 0,
      rateId: 'agent-flow-action',
      internalShare,
      licensedShareOfInternal: licensed,
      formula: studio.triggersFlows
        ? 'flowActions = conversations × flowActionsPerConversation'
        : 'flowActions = 0 (agents do not trigger flows)',
      inputs: {
        conversations,
        flowActionsPerConversation: studio.flowActionsPerConversation,
        triggersFlows: studio.triggersFlows,
      },
    });
  }

  /* ---------------- Microsoft 365 Copilot Chat ---------------- */
  const chat = usage['m365-copilot-chat'];
  if (chat) {
    const messages = chat.users * chat.messagesPerUserPerDay * chat.businessDaysPerMonth;
    const licensed = chat.m365CopilotLicensedPct / 100;
    push('m365-copilot-chat', {
      lineId: 'm365-copilot-chat:generative',
      label: 'Copilot Chat — generative answers',
      quantity: messages * (chat.generativeSharePct / 100),
      rateId: 'generative-answer',
      internalShare: 1,
      licensedShareOfInternal: licensed,
      formula:
        'generativeMessages = users × messagesPerUserPerDay × businessDaysPerMonth × generativeSharePct ÷ 100',
      inputs: {
        users: chat.users,
        messagesPerUserPerDay: chat.messagesPerUserPerDay,
        businessDaysPerMonth: chat.businessDaysPerMonth,
        generativeSharePct: chat.generativeSharePct,
      },
    });
    push('m365-copilot-chat', {
      lineId: 'm365-copilot-chat:classic',
      label: 'Copilot Chat — classic answers',
      quantity: messages * (1 - chat.generativeSharePct / 100),
      rateId: 'classic-answer',
      internalShare: 1,
      licensedShareOfInternal: licensed,
      formula: 'classicMessages = messages × (1 − generativeSharePct ÷ 100)',
      inputs: { messages, generativeSharePct: chat.generativeSharePct },
    });
    push('m365-copilot-chat', {
      lineId: 'm365-copilot-chat:grounding',
      label: 'Copilot Chat — tenant Graph grounding',
      quantity: messages * (chat.graphGroundingPct / 100),
      rateId: 'tenant-graph-grounding',
      internalShare: 1,
      licensedShareOfInternal: licensed,
      formula: 'groundedMessages = messages × graphGroundingPct ÷ 100',
      inputs: { messages, graphGroundingPct: chat.graphGroundingPct },
    });
  }

  /* ---------------- SharePoint agents ---------------- */
  const sharepoint = usage['sharepoint-agents'];
  if (sharepoint) {
    const messages =
      sharepoint.agentCount *
      sharepoint.usersPerAgent *
      sharepoint.messagesPerUserPerDay *
      sharepoint.businessDaysPerMonth;
    const licensed = sharepoint.m365CopilotLicensedPct / 100;
    push('sharepoint-agents', {
      lineId: 'sharepoint-agents:generative',
      label: 'SharePoint agents — generative answers',
      quantity: messages,
      rateId: 'generative-answer',
      internalShare: 1,
      licensedShareOfInternal: licensed,
      formula:
        'messages = agentCount × usersPerAgent × messagesPerUserPerDay × businessDaysPerMonth',
      inputs: {
        agentCount: sharepoint.agentCount,
        usersPerAgent: sharepoint.usersPerAgent,
        messagesPerUserPerDay: sharepoint.messagesPerUserPerDay,
        businessDaysPerMonth: sharepoint.businessDaysPerMonth,
      },
    });
    push('sharepoint-agents', {
      lineId: 'sharepoint-agents:grounding',
      label: 'SharePoint agents — tenant Graph grounding',
      quantity: messages * (sharepoint.graphGroundingPct / 100),
      rateId: 'tenant-graph-grounding',
      internalShare: 1,
      licensedShareOfInternal: licensed,
      formula: 'groundedMessages = messages × graphGroundingPct ÷ 100',
      inputs: { messages, graphGroundingPct: sharepoint.graphGroundingPct },
    });
  }

  /* ---------------- Copilot Studio agent flows ---------------- */
  const flows = usage['copilot-studio-flows'];
  if (flows) {
    push('copilot-studio-flows', {
      lineId: 'copilot-studio-flows:actions',
      label: 'Agent flows — flow actions',
      quantity: flows.flowRunsPerMonth * flows.actionsPerRun,
      rateId: 'agent-flow-action',
      internalShare: 1,
      licensedShareOfInternal: flows.m365CopilotLicensedPct / 100,
      formula: 'flowActions = flowRunsPerMonth × actionsPerRun',
      inputs: { flowRunsPerMonth: flows.flowRunsPerMonth, actionsPerRun: flows.actionsPerRun },
    });
  }

  /* ---------------- Voice agents ---------------- */
  const voice = usage['voice-agents'];
  if (voice) {
    const containment = voice.containmentRatePct / 100;
    const escalatedShare = assumptions.escalatedCallHandleShare;
    const effectiveHandleShare = containment + (1 - containment) * escalatedShare;
    const minutes =
      voice.callsPerDay *
      voice.businessDaysPerMonth *
      voice.avgHandleTimeMinutes *
      effectiveHandleShare;
    const rateId: ConsumptionRateId =
      voice.tier === 'classic'
        ? 'voice-classic-minute'
        : voice.tier === 'genai'
          ? 'voice-genai-minute'
          : 'voice-premium-genai-minute';
    push('voice-agents', {
      lineId: 'voice-agents:minutes',
      label: `Voice agents — ${voice.tier} minutes`,
      quantity: minutes,
      rateId,
      internalShare: 0,
      licensedShareOfInternal: 0,
      formula:
        'minutes = callsPerDay × businessDaysPerMonth × avgHandleTimeMinutes × (containment + (1 − containment) × escalatedCallHandleShare)',
      inputs: {
        callsPerDay: voice.callsPerDay,
        businessDaysPerMonth: voice.businessDaysPerMonth,
        avgHandleTimeMinutes: voice.avgHandleTimeMinutes,
        containmentRatePct: voice.containmentRatePct,
        escalatedCallHandleShare: escalatedShare,
      },
    });
  }

  /* ---------------- AI tools / AI Builder ---------------- */
  const aiTools = usage['ai-tools'];
  if (aiTools) {
    const licensed = aiTools.m365CopilotLicensedPct / 100;
    const pages = aiTools.documentsPerMonth * aiTools.pagesPerDocument;
    const thousandTokens = (aiTools.responsesPerMonth * aiTools.tokensPerResponse) / 1000;
    const tokenRateId: ConsumptionRateId =
      aiTools.modelTier === 'basic'
        ? 'ai-tools-basic-tokens'
        : aiTools.modelTier === 'standard'
          ? 'ai-tools-standard-tokens'
          : 'ai-tools-premium-tokens';

    push('ai-tools', {
      lineId: 'ai-tools:content-processing',
      label: 'AI tools — content processing pages',
      quantity: pages,
      rateId: 'content-processing-page',
      internalShare: 1,
      licensedShareOfInternal: licensed,
      formula: 'pages = documentsPerMonth × pagesPerDocument',
      inputs: {
        documentsPerMonth: aiTools.documentsPerMonth,
        pagesPerDocument: aiTools.pagesPerDocument,
      },
    });
    push('ai-tools', {
      lineId: 'ai-tools:tokens',
      label: `AI tools — ${aiTools.modelTier} generative tokens`,
      quantity: thousandTokens,
      rateId: tokenRateId,
      internalShare: 1,
      licensedShareOfInternal: licensed,
      formula: 'thousandTokens = responsesPerMonth × tokensPerResponse ÷ 1000',
      inputs: {
        responsesPerMonth: aiTools.responsesPerMonth,
        tokensPerResponse: aiTools.tokensPerResponse,
        modelTier: aiTools.modelTier,
      },
    });
  }

  /* ---------------- Dynamics 365 out-of-box agents ---------------- */
  const d365 = usage['d365-agents'];
  if (d365) {
    const invocations = d365.users * d365.invocationsPerUserPerDay * d365.businessDaysPerMonth;
    const licensed = d365.m365CopilotLicensedPct / 100;
    push('d365-agents', {
      lineId: 'd365-agents:generative',
      label: 'Dynamics 365 agents — generative answers',
      quantity: invocations,
      rateId: 'generative-answer',
      internalShare: 1,
      licensedShareOfInternal: licensed,
      formula: 'invocations = users × invocationsPerUserPerDay × businessDaysPerMonth',
      inputs: {
        users: d365.users,
        invocationsPerUserPerDay: d365.invocationsPerUserPerDay,
        businessDaysPerMonth: d365.businessDaysPerMonth,
      },
    });
    push('d365-agents', {
      lineId: 'd365-agents:actions',
      label: 'Dynamics 365 agents — agent actions',
      quantity: invocations * d365.actionsPerInvocation,
      rateId: 'agent-action',
      internalShare: 1,
      licensedShareOfInternal: licensed,
      formula: 'actions = invocations × actionsPerInvocation',
      inputs: { invocations, actionsPerInvocation: d365.actionsPerInvocation },
    });
  }

  /* ---------------- Role-based Copilots ---------------- */
  const roleBased = usage['role-based-copilots'];
  if (roleBased) {
    const interactions =
      roleBased.users * roleBased.interactionsPerUserPerDay * roleBased.businessDaysPerMonth;
    const licensed = roleBased.m365CopilotLicensedPct / 100;
    push('role-based-copilots', {
      lineId: 'role-based-copilots:generative',
      label: 'Role-based Copilots — generative answers',
      quantity: interactions,
      rateId: 'generative-answer',
      internalShare: 1,
      licensedShareOfInternal: licensed,
      formula: 'interactions = users × interactionsPerUserPerDay × businessDaysPerMonth',
      inputs: {
        users: roleBased.users,
        interactionsPerUserPerDay: roleBased.interactionsPerUserPerDay,
        businessDaysPerMonth: roleBased.businessDaysPerMonth,
      },
    });
    push('role-based-copilots', {
      lineId: 'role-based-copilots:actions',
      label: 'Role-based Copilots — agent actions',
      quantity: interactions * roleBased.actionsPerInteraction,
      rateId: 'agent-action',
      internalShare: 1,
      licensedShareOfInternal: licensed,
      formula: 'actions = interactions × actionsPerInteraction',
      inputs: { interactions, actionsPerInteraction: roleBased.actionsPerInteraction },
    });
  }

  /* ---------------- Copilot Cowork / Work IQ ---------------- */
  const cowork = usage['copilot-cowork'];
  if (cowork) {
    push('copilot-cowork', {
      lineId: 'copilot-cowork:tasks',
      label: 'Copilot Cowork — completed tasks',
      quantity: cowork.users * cowork.tasksPerUserPerMonth,
      rateId: 'cowork-task',
      internalShare: 1,
      licensedShareOfInternal: cowork.m365CopilotLicensedPct / 100,
      formula: 'tasks = users × tasksPerUserPerMonth',
      inputs: { users: cowork.users, tasksPerUserPerMonth: cowork.tasksPerUserPerMonth },
    });
  }

  /* ---------------- Microsoft Foundry / BYOM ---------------- */
  const foundry = usage['foundry-byom'];
  if (foundry) {
    push('foundry-byom', {
      lineId: 'foundry-byom:actions',
      label: 'Foundry BYOM — agent actions',
      quantity: foundry.agentActionsPerMonth,
      rateId: 'agent-action',
      internalShare: 1,
      licensedShareOfInternal: normalised.internalLicensedShare,
      formula: 'agentActions = agentActionsPerMonth (model inference billed separately as Azure tokens)',
      inputs: { agentActionsPerMonth: foundry.agentActionsPerMonth },
    });
  }

  /* ---------------- Retrieval API ---------------- */
  const retrieval = usage['retrieval-api'];
  if (retrieval) {
    push('retrieval-api', {
      lineId: 'retrieval-api:queries',
      label: 'Retrieval API — queries',
      quantity: retrieval.queriesPerMonth,
      rateId: 'retrieval-api-query',
      internalShare: 1,
      licensedShareOfInternal: 0,
      formula: 'queries = queriesPerMonth (metered regardless of licence)',
      inputs: { queriesPerMonth: retrieval.queriesPerMonth },
    });
  }

  /* ---------------- GitHub Copilot ---------------- */
  const github = usage['github-copilot'];
  if (github) {
    const heavyShare = github.heavyUserPct / 100;
    const perUserRequests =
      heavyShare * assumptions.githubPremiumRequestsPerHeavyUserPerMonth +
      (1 - heavyShare) * assumptions.githubPremiumRequestsPerStandardUserPerMonth;
    const tierMultiplier = assumptions.githubModelTierMultiplier[github.modelTier] ?? 1;
    const totalRequests = github.seats * perUserRequests * tierMultiplier;
    const included =
      github.seats * card.commercial.githubCopilot[github.plan].includedPremiumRequestsPerUser;
    const overage = Math.max(0, totalRequests - included);

    audit.record(
      'volume:github-copilot:premium-requests',
      'premiumRequests = seats × (heavyPct × heavyRate + (1 − heavyPct) × standardRate) × modelTierMultiplier',
      {
        seats: github.seats,
        heavyUserPct: github.heavyUserPct,
        heavyRate: assumptions.githubPremiumRequestsPerHeavyUserPerMonth,
        standardRate: assumptions.githubPremiumRequestsPerStandardUserPerMonth,
        modelTier: github.modelTier,
        modelTierMultiplier: tierMultiplier,
      },
      totalRequests,
      'premium requests/month',
    );

    push('github-copilot', {
      lineId: 'github-copilot:overage',
      label: 'GitHub Copilot — premium requests beyond the included allowance',
      quantity: overage,
      rateId: 'github-premium-request',
      internalShare: 1,
      licensedShareOfInternal: 0,
      formula:
        'overageRequests = max(0, premiumRequests − seats × includedPremiumRequestsPerUser)',
      inputs: {
        premiumRequests: totalRequests,
        seats: github.seats,
        includedPremiumRequestsPerUser:
          card.commercial.githubCopilot[github.plan].includedPremiumRequestsPerUser,
        plan: github.plan,
      },
    });
  }

  return { lines, totalsByWorkload };
}
