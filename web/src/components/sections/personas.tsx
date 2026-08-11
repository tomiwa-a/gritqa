import { Section } from '@/components/ui/section';
import { SectionHead, Prose } from '@/components/ui/typography';
import { Card, SpecList } from '@/components/ui/card';

const PERSONAS: {
  who: string;
  situation: string;
  gets: string[];
}[] = [
  {
    who: 'You are shipping alone',
    situation:
      'There is no QA person, and there is not going to be one. Tests are the thing you keep meaning to write once the feature is done.',
    gets: [
      'Coverage you did not have to sit down and write',
      'A five-minute review instead of an afternoon of test code',
      'Confidence to change something on a Friday',
    ],
  },
  {
    who: 'You are three or four people',
    situation:
      'Everyone owns everything, reviews are already a bottleneck, and nobody remembers which endpoints are actually covered.',
    gets: [
      'One place that shows what is tested and what is not',
      'Your team’s standards written down once, applied to every draft',
      'A record of who approved which test, and when',
    ],
  },
  {
    who: 'You do QA for a living',
    situation:
      'You know exactly which cases matter and which ones the team keeps skipping. You are not short on judgement — you are short on hours to type it all out.',
    gets: [
      'You own the approval gate; nothing runs without a sign-off',
      'Your rules steer every draft, so the AI works to your standard',
      'Regression, negative paths and black-box coverage from day one',
      'A signed history of every plan, run and result',
    ],
  },
  {
    who: 'You work on the backend',
    situation:
      'You care about the database, the ordering, and the edge case at 2am — not about clicking through a browser recorder.',
    gets: [
      'Tests that hit a real database with your real migrations',
      'Requests that chain, in the order the API actually requires',
      'Full control of every assertion before it counts against you',
    ],
  },
];

export function Personas() {
  return (
    <Section id="who-its-for" space="md" divide frame>
      <SectionHead
        index="04"
        eyebrow="Who it’s for"
        title="Whether you have a QA team or you are the QA team."
        lead="Teams without a tester get one that never runs out of patience. Teams with testers get their time back — the judgement stays with the people who have it, and the typing goes away."
        className="max-w-2xl"
      />

      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:mt-16">
        {PERSONAS.map((p) => (
          <Card key={p.who} interactive className="flex flex-col gap-5 p-6">
            <h3 className="font-heading text-[1.125rem] font-semibold tracking-[-0.015em] text-ink">
              {p.who}
            </h3>
            <Prose>{p.situation}</Prose>
            <SpecList items={p.gets} className="mt-auto border-t border-rule pt-5" />
          </Card>
        ))}
      </div>
    </Section>
  );
}
