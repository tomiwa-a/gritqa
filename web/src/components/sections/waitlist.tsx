import { Section } from '@/components/ui/section';
import { Display, Accent, Eyebrow, Lead } from '@/components/ui/typography';
import { WaitlistForm } from '@/components/waitlist-form';

const ASSURANCES = [
  'One email when the binary is ready',
  'No newsletter, no drip sequence',
  'Unsubscribe in a single click',
];

export function Waitlist() {
  return (
    <Section id="waitlist" tone="dark" space="lg" grid frame>
      <div className="mx-auto flex max-w-[46rem] flex-col items-center text-center">
        <Eyebrow index="05" tone="dark">
          Private beta
        </Eyebrow>

        <Display as="h2" size="lg" tone="dark" className="mt-6 max-w-[22ch]">
          Stop writing the tests you already <Accent>described</Accent> in code.
        </Display>

        <Lead tone="dark" className="mt-6">
          The first build goes out to a small group of backend teams. Leave an
          email and we will send it the day it runs end to end.
        </Lead>

        <WaitlistForm tone="dark" className="mt-10 max-w-lg" />
      </div>

      <ul className="mx-auto mt-14 grid max-w-4xl gap-x-8 gap-y-6 border-t border-rule-dark pt-6 sm:grid-cols-3">
        {ASSURANCES.map((a) => (
          <li key={a} className="flex items-baseline gap-2.5">
            <span aria-hidden className="mt-[0.5em] h-px w-3 shrink-0 bg-rule-dark" />
            <span className="text-[13px] leading-[1.55] text-term-dim">{a}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
