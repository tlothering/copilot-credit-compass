'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/ui';

/* ------------------------------------------------------------------ Button */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
};

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-field font-medium ' +
  'transition-[transform,background-color,border-color,box-shadow] duration-150 ' +
  'active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45';

const BUTTON_VARIANT: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'border border-line-strong bg-bg-raised text-fg hover:border-accent-line',
  ghost: 'text-fg-muted hover:bg-accent-quiet hover:text-fg',
  danger: 'border border-risk text-risk hover:bg-risk-quiet',
};

const BUTTON_SIZE: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
      {...props}
    />
  );
});

/* -------------------------------------------------------------------- Card */

export function Card({
  className,
  as: As = 'div',
  ...props
}: React.HTMLAttributes<HTMLElement> & { as?: React.ElementType }) {
  return <As className={cn('card p-5', className)} {...props} />;
}

export function CardTitle({
  children,
  hint,
  right,
}: {
  children: React.ReactNode;
  hint?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">{children}</h3>
        {hint ? <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p> : null}
      </div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------- Badge */

const BADGE_TONES = {
  neutral: 'border-line text-fg-muted',
  accent: 'border-accent-line bg-accent-quiet text-fg',
  success: 'border-success bg-success-quiet text-fg',
  warn: 'border-warn bg-warn-quiet text-fg',
  risk: 'border-risk bg-risk-quiet text-fg',
  info: 'border-info bg-info-quiet text-fg',
} as const;

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: keyof typeof BADGE_TONES;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
