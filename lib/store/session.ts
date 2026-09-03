'use client';

import { create } from 'zustand';
import {
  type Answers,
  type Consent,
  type Growth,
  type Profile,
  type Usage,
  WORKLOAD_DEFAULTS,
  defaultAnswers,
} from '@/lib/schemas/answers';
import type { WorkloadId } from '@/lib/schemas/taxonomy';

export const STORAGE_KEY = 'ccc-session-v1';
export const TOTAL_STEPS = 6;

type UsageFor<K extends WorkloadId> = NonNullable<Usage[K]>;

export interface SessionState {
  answers: Answers;
  /** Dot-paths the user explicitly answered. Everything else is a default. */
  touched: string[];
  /** Highest wizard step the user has reached — gates forward navigation. */
  maxStep: number;
  /** Set once the user has entered anything worth losing. */
  dirty: boolean;
  /** True after the sessionStorage mirror has been read on the client. */
  hydrated: boolean;
  /** Populated when a completed run is stored, so /results can render. */
  submittedAt: string | null;

  setProfile: (patch: Partial<Profile>) => void;
  setWorkloads: (ids: WorkloadId[]) => void;
  toggleWorkload: (id: WorkloadId) => void;
  setUsage: <K extends WorkloadId>(id: K, patch: Partial<UsageFor<K>>) => void;
  resetUsage: (id: WorkloadId) => void;
  setGrowth: (patch: Partial<Growth>) => void;
  setConsent: (patch: Partial<Consent>) => void;
  markTouched: (path: string) => void;
  isTouched: (path: string) => boolean;
  visitStep: (step: number) => void;
  markSubmitted: () => void;
  reset: () => void;
  hydrate: () => void;
}

interface Persisted {
  answers: Answers;
  touched: string[];
  maxStep: number;
  submittedAt: string | null;
}

function readMirror(): Persisted | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<Persisted>;
    if (typeof candidate.answers !== 'object' || candidate.answers === null) return null;
    return {
      answers: candidate.answers,
      touched: Array.isArray(candidate.touched) ? candidate.touched : [],
      maxStep: typeof candidate.maxStep === 'number' ? candidate.maxStep : 0,
      submittedAt: typeof candidate.submittedAt === 'string' ? candidate.submittedAt : null,
    };
  } catch {
    // Corrupt or blocked storage is not fatal — the in-memory session still works.
    return null;
  }
}

function writeMirror(state: SessionState): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: Persisted = {
      answers: state.answers,
      touched: state.touched,
      maxStep: state.maxStep,
      submittedAt: state.submittedAt,
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota or private mode. Memory remains the source of truth (constraint C2).
  }
}

function withTouched(touched: string[], paths: string[]): string[] {
  const next = new Set(touched);
  for (const p of paths) next.add(p);
  return [...next];
}

export const useSession = create<SessionState>()((set, get) => {
  /** Applies a state patch, marks the session dirty, and mirrors to sessionStorage. */
  const commit = (patch: Partial<SessionState>) => {
    set(patch);
    writeMirror(get());
  };

  return {
    answers: defaultAnswers(),
    touched: [],
    maxStep: 0,
    dirty: false,
    hydrated: false,
    submittedAt: null,

    setProfile: (patch) => {
      const { answers, touched } = get();
      commit({
        answers: { ...answers, profile: { ...answers.profile, ...patch } },
        touched: withTouched(
          touched,
          Object.keys(patch).map((k) => `profile.${k}`),
        ),
        dirty: true,
      });
    },

    setWorkloads: (ids) => {
      const { answers, touched } = get();
      const usage: Usage = {};
      // Preserve answers for workloads that survive the change; seed new ones.
      for (const id of ids) {
        const existing = answers.usage[id];
        usage[id] = (existing ?? WORKLOAD_DEFAULTS[id]) as never;
      }
      commit({
        answers: { ...answers, workloads: ids, usage },
        touched: withTouched(touched, ['workloads']),
        dirty: true,
      });
    },

    toggleWorkload: (id) => {
      const current = get().answers.workloads;
      const next = current.includes(id)
        ? current.filter((w) => w !== id)
        : // Preserve the canonical taxonomy order rather than click order.
          (Object.keys(WORKLOAD_DEFAULTS) as WorkloadId[]).filter(
            (w) => w === id || current.includes(w),
          );
      get().setWorkloads(next);
    },

    setUsage: (id, patch) => {
      const { answers, touched } = get();
      const base = (answers.usage[id] ?? WORKLOAD_DEFAULTS[id]) as UsageFor<typeof id>;
      commit({
        answers: {
          ...answers,
          usage: { ...answers.usage, [id]: { ...base, ...patch } },
        },
        touched: withTouched(
          touched,
          Object.keys(patch).map((k) => `usage.${id}.${k}`),
        ),
        dirty: true,
      });
    },

    resetUsage: (id) => {
      const { answers, touched } = get();
      const prefix = `usage.${id}.`;
      commit({
        answers: {
          ...answers,
          usage: { ...answers.usage, [id]: WORKLOAD_DEFAULTS[id] as never },
        },
        touched: touched.filter((p) => !p.startsWith(prefix)),
        dirty: true,
      });
    },

    setGrowth: (patch) => {
      const { answers, touched } = get();
      commit({
        answers: { ...answers, growth: { ...answers.growth, ...patch } },
        touched: withTouched(
          touched,
          Object.keys(patch).map((k) => `growth.${k}`),
        ),
        dirty: true,
      });
    },

    setConsent: (patch) => {
      const { answers } = get();
      commit({
        answers: { ...answers, consent: { ...answers.consent, ...patch } },
        dirty: true,
      });
    },

    markTouched: (path) => commit({ touched: withTouched(get().touched, [path]) }),

    isTouched: (path) => get().touched.includes(path),

    visitStep: (step) => {
      if (step <= get().maxStep) return;
      commit({ maxStep: Math.min(step, TOTAL_STEPS - 1) });
    },

    markSubmitted: () => commit({ submittedAt: new Date().toISOString() }),

    reset: () => {
      set({
        answers: defaultAnswers(),
        touched: [],
        maxStep: 0,
        dirty: false,
        submittedAt: null,
      });
      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          /* nothing to clear */
        }
      }
    },

    hydrate: () => {
      if (get().hydrated) return;
      const mirror = readMirror();
      if (mirror) {
        set({
          answers: mirror.answers,
          touched: mirror.touched,
          maxStep: mirror.maxStep,
          submittedAt: mirror.submittedAt,
          dirty: mirror.touched.length > 0,
          hydrated: true,
        });
      } else {
        set({ hydrated: true });
      }
    },
  };
});

/** Count of questions left at their industry default, for the "you skipped N" note. */
export function skippedCount(state: Pick<SessionState, 'answers' | 'touched'>): number {
  let total = 0;
  let answered = 0;
  const countGroup = (prefix: string, keys: string[]) => {
    for (const k of keys) {
      total += 1;
      if (state.touched.includes(`${prefix}.${k}`)) answered += 1;
    }
  };
  countGroup('profile', Object.keys(state.answers.profile));
  countGroup('growth', Object.keys(state.answers.growth));
  for (const id of state.answers.workloads) {
    const block = state.answers.usage[id];
    if (block) countGroup(`usage.${id}`, Object.keys(block));
  }
  return total - answered;
}
