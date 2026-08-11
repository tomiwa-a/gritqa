import { Section } from '@/components/ui/section';
import { SectionHead, Prose } from '@/components/ui/typography';
import { StatRail } from '@/components/ui/stat-rail';
import { Card } from '@/components/ui/card';
import { Rule, Leader } from '@/components/ui/rule';
import { Badge } from '@/components/ui/badge';

const SUPPORTED: [string, string][] = [
  ['Language', 'Go 1.21+, Node 18+'],
  ['Routers', 'chi, Gin, Echo, Express, Fastify, Nest'],
  ['Type sources', 'structs, zod, class-validator, OpenAPI'],
  ['Auth schemes', 'bearer, basic, API key, cookie session'],
  ['Transport', 'HTTP/1.1, HTTP/2, JSON bodies'],
  ['Plan format', 'YAML in .gritqa/, one file per flow'],
  ['Reporters', 'terminal, JUnit XML, JSON'],
  ['Runs in', 'local shell, any CI that runs a binary'],
];

const OUT_OF_SCOPE: [string, string][] = [
  ['GraphQL', 'one endpoint, no route graph to read'],
  ['gRPC', 'needs a different transport layer'],
  ['WebSockets', 'no request/response pair to assert on'],
  ['Browser E2E', 'Playwright already does this well'],
  ['Load testing', 'correctness first; throughput is a different tool'],
  ['Mock servers', 'the point is to hit your real handlers'],
];

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline py-2.5">
      <dt className="shrink-0 font-mono text-[11px] tracking-[0.14em] text-ink-subtle uppercase">
        {label}
      </dt>
      <Leader />
      <dd className="shrink-0 text-right text-[13.5px] text-ink-muted">{value}</dd>
    </div>
  );
}

export function Spec() {
  return (
    <Section id="spec" space="md" divide frame>
      <SectionHead
        index="04"
        eyebrow="Spec"
        title="The honest sheet, including what it will not do."
        lead="Scope is the feature. Below is everything GritQA reads today, and the things it deliberately leaves to other tools."
        className="max-w-2xl"
      />

      <StatRail
        className="mt-12"
        items={[
          { value: '2', label: 'Languages at launch' },
          { value: '6', label: 'Routers detected' },
          { value: '1', label: 'Command to learn' },
          { value: '0', label: 'Agents installed' },
        ]}
      />

      <div className="mt-14 grid gap-x-12 gap-y-12 lg:grid-cols-12">
        {/* Supported */}
        <div className="lg:col-span-7">
          <Rule label="Supported today" />
          <dl className="mt-5 divide-y divide-rule">
            {SUPPORTED.map(([label, value]) => (
              <SpecRow key={label} label={label} value={value} />
            ))}
          </dl>
        </div>

        {/* Out of scope */}
        <div className="lg:col-span-5">
          <Rule label="Out of scope" />
          <Card className="mt-5 p-6">
            <Prose className="border-b border-rule pb-5">
              Not a roadmap gap to apologise for — each of these needs a different
              approach than reading routes, so shipping a shallow version would
              only make the tool harder to trust.
            </Prose>

            <ul className="mt-5 space-y-3.5">
              {OUT_OF_SCOPE.map(([name, why]) => (
                <li key={name} className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-2.5">
                    <span aria-hidden className="mt-[0.55em] h-px w-3 shrink-0 bg-rule-strong" />
                    <span className="text-[13.5px] font-medium text-ink">{name}</span>
                  </div>
                  <span className="pl-[1.4rem] text-[12.5px] leading-[1.55] text-ink-subtle">
                    {why}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {/* Status footnote */}
      <div className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-rule pt-6">
        <Badge variant="outline" size="sm" mono>
          v0.1.0
        </Badge>
        <p className="text-[13px] text-ink-subtle">
          Pre-release. The spec above is what we are building to, not a shipped
          changelog — the waitlist gets the first working binary.
        </p>
      </div>
    </Section>
  );
}
