import { Icon } from '@/components/ui/icon';
import { requestRecheckAction } from '@/lib/actions/recheck';
import { cn } from '@/lib/cn';

/**
 * Look again at one step: queues a focused recheck that merges a fresh
 * verdict into the plan's existing checks. A quiet inline form, because it
 * lives inside doubt rows, spine flags and drawer verdicts alike.
 */
export function LookAgainButton({
  planPublicId,
  stepId,
  className,
}: {
  planPublicId: string;
  stepId: string;
  className?: string;
}) {
  return (
    <form action={requestRecheckAction}>
      <input type="hidden" name="plan" value={planPublicId} />
      <input type="hidden" name="step" value={stepId} />
      <button
        type="submit"
        title="Queue a focused re-read of this step"
        className={cn(
          'flex items-center gap-1 text-[11.5px] font-medium text-ink-subtle transition-colors duration-150 hover:text-ink',
          className,
        )}
      >
        <Icon name="refresh" size={12} />
        Look again
      </button>
    </form>
  );
}
