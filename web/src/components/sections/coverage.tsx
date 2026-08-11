import { Section } from '@/components/ui/section';
import { SectionHead, Prose } from '@/components/ui/typography';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

type TestType = { name: string; body: string };

const NOW: TestType[] = [
  {
    name: 'Integration flows',
    body: 'Chained API requests against a real database — sign in, create, update, check the result — in the order your API requires.',
  },
  {
    name: 'Regression',
    body: 'Approved plans re-run whenever you touch code they cover, so you find out the moment old behaviour changes.',
  },
  {
    name: 'Black box',
    body: 'Everything goes through your public API over real HTTP. No hooks in your code, no access to internals.',
  },
  {
    name: 'Negative paths',
    body: 'The cases people skip: rejected credentials, bad input, missing fields, someone else’s record.',
  },
];

const NEXT: TestType[] = [
  {
    name: 'White box',
    body: 'Assert on what a request leaves behind — the rows written, the state changed, the job queued.',
  },
  {
    name: 'Load',
    body: 'Take an approved flow and run it as hundreds of concurrent users to see what holds.',
  },
  {
    name: 'Stress',
    body: 'Push past what the service is meant to take and find the point where it gives out.',
  },
  {
    name: 'Security probes',
    body: 'The usual suspects: broken authorisation, fields that leak, input that should never have been accepted.',
  },
];

function TypeRow({ type, dim = false }: { type: TestType; dim?: boolean }) {
  return (
    <div
      className={cn(
        'border-t pt-4',
        dim ? 'border-dashed border-rule-strong' : 'border-rule-strong',
      )}
    >
      <h4 className={cn('text-[14px] font-semibold', dim ? 'text-ink-muted' : 'text-ink')}>
        {type.name}
      </h4>
      <p className="mt-1.5 text-[13.5px] leading-[1.6] text-ink-muted">{type.body}</p>
    </div>
  );
}

function GroupHead({
  title,
  badge,
  variant,
  className,
}: {
  title: string;
  badge: string;
  variant: 'approved' | 'draft';
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <h3 className="font-heading text-[1.25rem] font-semibold tracking-[-0.015em] text-ink">
        {title}
      </h3>
      <Badge variant={variant} size="sm">
        {badge}
      </Badge>
    </div>
  );
}

export function Coverage() {
  return (
    <Section id="coverage" tone="sunken" space="md" divide frame>
      <SectionHead
        index="03"
        eyebrow="What you can test"
        title="Every kind of test your team already argues about."
        lead="GritQA starts with the API tests nobody wants to hand-write, and grows into the rest of the pyramid. If you have people who do QA for a living, they set the rules and decide which kinds run — the tool just does the typing."
        className="max-w-3xl"
      />

      <div className="mt-12 grid items-start gap-x-10 gap-y-5 lg:mt-16 lg:grid-flow-col lg:grid-rows-[auto_auto_auto_auto_auto]">
        <GroupHead title="In the beta" badge="Shipping" variant="approved" />
        {NOW.map((t) => (
          <TypeRow key={t.name} type={t} />
        ))}

        <GroupHead title="Next" badge="Not yet" variant="draft" className="mt-8 lg:mt-0" />
        {NEXT.map((t) => (
          <TypeRow key={t.name} type={t} dim />
        ))}
      </div>

      <div className="mt-14 border-t border-rule pt-6">
        <Prose className="max-w-[64ch]">
          The order is deliberate. Integration tests are the ones that catch real
          breakage and the ones teams most often go without, so they come first.
          Everything after that runs on the same approved plans — once a flow is
          signed off, pointing load or security at it is a setting, not a rewrite.
        </Prose>
      </div>
    </Section>
  );
}
