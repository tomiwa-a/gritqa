import Link from 'next/link';
import { KeyField } from '@/components/app/settings/key-field';
import { Icon } from '@/components/ui/icon';
import { buttonVariants } from '@/components/ui/button';

/**
 * The onboarding step for the model key, which is the same control as the one in
 * settings and now literally the same component.
 *
 * It used to be a second implementation: its own input, its own fake save, and a
 * base URL and model field beside them with no column to land in. That is why it
 * needed a disclaimer. One control that writes needs no disclaimer, and there is
 * only one place to change when the vault changes.
 *
 * The endpoint is not asked for because it is not per-developer yet -- the AI
 * settings screen says the same thing, and asking for something that gets thrown
 * away is how the old version got to be misleading.
 */
export function ProviderStep({ masked }: { masked: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-ink-muted">
        GritQA drafts plans with your key, on your account, so you keep the bill and the choice of
        model. Only the files you change are sent, only when you ask for a draft, and never before.
      </p>

      <KeyField masked={masked} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule bg-app px-3 py-2.5">
        <p className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-muted">
          <Icon name="plan" size={13} className="mt-px shrink-0 text-ink-subtle" />
          Would rather not involve a model at all? Write the plans yourself and GritQA will run
          them.
        </p>
        <Link
          href="/dashboard/test-plans"
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          Write a plan
        </Link>
      </div>
    </div>
  );
}
