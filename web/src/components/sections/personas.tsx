import { Section } from '@/components/ui/section';
import { SectionHead, Prose } from '@/components/ui/typography';
import { Card, SpecList } from '@/components/ui/card';

/* Who this is for, in the words those people would use about themselves.
   Straight from the audience the product was scoped around. */

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
        index="03"
        eyebrow="Who it’s for"
        title="Built for the teams that never got a QA hire."
        lead="If testing your API currently means writing requests by hand, maintaining fixtures, and keeping a collection in sync with an API that moved last week — this replaces all three."
        className="max-w-2xl"
      />

      <div className="mt-14 grid gap-6 lg:mt-16 lg:grid-cols-3">
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
