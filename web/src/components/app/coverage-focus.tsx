import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { Badge, StatusDot } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { MethodBadge } from '@/components/ui/method-badge';
import { COVERAGE_FILL, COVERAGE_LABEL, COVERAGE_NEXT, COVERAGE_ORDER, COVERAGE_TONE } from '@/lib/coverage';
import { endpointHref, type EndpointFocus } from '@/lib/plan';
import { failedRunForEndpoint } from '@/lib/runs';
import type { CoverageFile, CoverageState, TestPlan } from '@/lib/mock/types';

function Shell({
  eyebrow,
  children,
  clearLabel,
}: {
  eyebrow: React.ReactNode;
  children: React.ReactNode;
  clearLabel: string;
}) {
  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-rule bg-app-panel shadow-panel">
      <div className="flex items-center gap-3 border-b border-rule-soft bg-app px-4 py-2">
        <span className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[10.5px] tracking-[0.12em] text-ink-subtle uppercase">
          {eyebrow}
        </span>
        <Link
          href="/dashboard/test-plans"
          className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          <Icon name="close" size={12} />
          {clearLabel}
        </Link>
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

/** One CTA per state, so a square always lands somewhere it can be acted on. */
function NextAction({
  state,
  plans,
  method,
  path,
  generateHref,
}: {
  state: CoverageState;
  plans: TestPlan[];
  method: string;
  path: string;
  /** Where drafting starts — the wizard opens over this page. */
  generateHref: string;
}) {
  if (state === 'failing') {
    const run = failedRunForEndpoint(method, path);
    if (run) {
      return (
        <Link
          href={`/dashboard/runs/${run.publicId}`}
          className={buttonVariants({ variant: 'primary', size: 'sm' })}
        >
          <Icon name="alert" size={14} />
          Read the run that broke
        </Link>
      );
    }
  }

  if (state === 'draft') {
    const draft = plans.find((p) => p.status === 'draft');
    if (draft) {
      return (
        <Link
          href={`/dashboard/queue?plan=${draft.publicId}`}
          className={buttonVariants({ variant: 'primary', size: 'sm' })}
        >
          <Icon name="queue" size={14} />
          Review the draft
        </Link>
      );
    }
  }

  if (state === 'approved') {
    const approved = plans.find((p) => p.status === 'approved') ?? plans[0];
    if (approved) {
      return (
        <Link
          href={`/dashboard/test-plans/${approved.publicId}`}
          className={buttonVariants({ variant: 'primary', size: 'sm' })}
        >
          <Icon name="plan" size={14} />
          Open the plan that covers it
        </Link>
      );
    }
  }

  return (
    <Link
      href={generateHref}
      scroll={false}
      className={buttonVariants({ variant: 'primary', size: 'sm' })}
    >
      <Icon name="sparkle" size={14} />
      Draft a plan for this
    </Link>
  );
}

export function EndpointFocusHeader({
  focus,
  plans,
  generateHref,
}: {
  focus: EndpointFocus;
  plans: TestPlan[];
  generateHref: string;
}) {
  return (
    <Shell eyebrow="one endpoint" clearLabel="Clear">
      <div className="flex flex-wrap items-center gap-2.5">
        <MethodBadge method={focus.method} />
        <h2 className="min-w-0 font-mono text-[15px] font-medium text-ink">{focus.path}</h2>
        <Badge variant="outline" size="sm" className="bg-app-panel">
          <StatusDot tone={COVERAGE_TONE[focus.state]} label={COVERAGE_LABEL[focus.state]} />
          {COVERAGE_LABEL[focus.state]}
        </Badge>
      </div>

      <p className="mt-2 max-w-[68ch] text-[13px] leading-relaxed text-ink-muted">
        {COVERAGE_NEXT[focus.state]} It lives in{' '}
        <Link
          href={`/dashboard/test-plans?file=${encodeURIComponent(focus.file)}`}
          className="font-mono text-[12.5px] text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
        >
          {focus.file}
        </Link>
        {plans.length === 0
          ? ', and no plan touches it today.'
          : `, and ${plans.length === 1 ? 'one plan touches' : `${plans.length} plans touch`} it.`}
      </p>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <NextAction
          state={focus.state}
          plans={plans}
          method={focus.method}
          path={focus.path}
          generateHref={generateHref}
        />
        <Link
          href={`/dashboard/test-plans?group=endpoint`}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          Every endpoint
        </Link>
      </div>
    </Shell>
  );
}

export function FileFocusHeader({ file, plans }: { file: CoverageFile; plans: TestPlan[] }) {
  const counts = file.endpoints.reduce<Record<string, number>>(
    (acc, e) => ({ ...acc, [e.state]: (acc[e.state] ?? 0) + 1 }),
    {},
  );

  return (
    <Shell eyebrow="one file" clearLabel="Clear">
      <h2 className="font-mono text-[15px] font-medium text-ink">{file.file}</h2>

      <p className="mt-2 max-w-[68ch] text-[13px] leading-relaxed text-ink-muted">
        {file.endpoints.length} endpoint{file.endpoints.length === 1 ? '' : 's'} live in this file.{' '}
        {plans.length === 0
          ? 'Nothing covers any of them yet.'
          : `${plans.length === 1 ? 'One plan reaches' : `${plans.length} plans reach`} into it.`}
      </p>

      <ul className="mt-3 flex flex-col gap-px overflow-hidden rounded-lg border border-rule-soft">
        {file.endpoints.map((e) => (
          <li key={`${e.method} ${e.path}`}>
            <Link
              href={endpointHref(e)}
              className="flex items-center gap-3 bg-app-panel px-3 py-2 transition-colors duration-150 hover:bg-app-hover"
            >
              <MethodBadge method={e.method} />
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                {e.path}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${COVERAGE_FILL[e.state]}`} />
                <span className="hidden text-[11.5px] text-ink-subtle sm:inline">
                  {COVERAGE_LABEL[e.state]}
                </span>
              </span>
              <Icon name="chevronRight" size={13} className="shrink-0 text-rule-strong" />
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        {COVERAGE_ORDER.filter((s) => counts[s]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-[3px] ${COVERAGE_FILL[s]}`} />
            <span className="text-[12px] text-ink-muted">{COVERAGE_LABEL[s]}</span>
            <span className="nums text-[12px] font-medium text-ink">{counts[s]}</span>
          </span>
        ))}
      </div>
    </Shell>
  );
}
