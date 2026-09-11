import Link from 'next/link';
import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { AppPageHeader } from '@/components/app/page-header';
import { Panel } from '@/components/app/panel';
import { GenerateMenu } from '@/components/app/generate-menu';
import { OverlayHost } from '@/components/app/overlay-host';
import { RuleRows } from '@/components/app/rules/rule-rows';
import { CATEGORY, CATEGORY_ORDER } from '@/components/app/rules/categories';
import { Segmented } from '@/components/ui/segmented';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { NoProjectGate } from '@/components/app/no-project-gate';
import { Icon } from '@/components/ui/icon';
import { getCurrentProjectOrNull, getRules } from '@/lib/data';
import { ruleToken, withOverlay, type PageParams } from '@/lib/overlay';
import type { RuleCategory } from '@/lib/model';

export const metadata = { title: 'Rules · GritQA' };

const PATH = '/dashboard/rules';

function isCategory(value: string | undefined): value is RuleCategory {
  return CATEGORY_ORDER.some((c) => c === value);
}

export default async function RulesPage({ searchParams }: { searchParams: Promise<PageParams> }) {
  const params = await searchParams;
  const project = await getCurrentProjectOrNull();
  if (!project) return <NoProjectGate icon="rules" title="Rules" />;
  const rules = await getRules();
  const categoryParam = typeof params.category === 'string' ? params.category : undefined;
  /* `category` is not an overlay param, so opening a rule keeps the filter and
     closing it comes back to the same narrowed list. Nothing to thread through. */
  const category = isCategory(categoryParam) ? categoryParam : null;
  const shown = category ? [category] : CATEGORY_ORDER;

  const openRule = (publicId: string) => withOverlay(PATH, params, ruleToken(publicId));
  const filterHref = (next: RuleCategory | null) => (next ? `${PATH}?category=${next}` : PATH);

  const off = rules.filter((r) => !r.isActive).length;

  return (
    <>
      <Topbar icon="rules" title="Rules" action={<GenerateMenu />} />

      <PageBody>
        <AppPageHeader
          title="Your team's testing standards"
          description="Ordering, mocks, assertions, and fixtures. Set them once and every plan drafted after that respects them."
          action={
            <Link
              href={withOverlay(PATH, params, ruleToken('new'))}
              scroll={false}
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
            >
              <Icon name="plus" size={14} />
              New rule
            </Link>
          }
        />

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
            <Segmented
              className="w-max"
              label="Which kind of rule to show"
              active={category ?? 'all'}
              options={[
                {
                  key: 'all',
                  label: 'All',
                  icon: 'rules',
                  href: filterHref(null),
                  count: rules.length,
                },
                ...CATEGORY_ORDER.map((key) => ({
                  key,
                  label: CATEGORY[key].label,
                  icon: CATEGORY[key].icon,
                  href: filterHref(key),
                  count: rules.filter((r) => r.category === key).length,
                })),
              ]}
            />
          </div>

          <p className="nums shrink-0 text-[12.5px] text-ink-subtle">
            {off > 0 ? `${rules.length - off} of ${rules.length} on` : `All ${rules.length} on`}
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {shown.map((key) => {
            const meta = CATEGORY[key];
            const group = rules.filter((r) => r.category === key);
            const groupOff = group.filter((r) => !r.isActive).length;

            return (
              <Panel
                key={key}
                id={key}
                title={meta.label}
                subtitle={meta.blurb}
                bodyClassName="p-0"
                meta={
                  groupOff > 0 ? (
                    <Badge variant="count" size="sm" className="nums shrink-0">
                      {groupOff} off
                    </Badge>
                  ) : undefined
                }
              >
                <RuleRows rules={group} hrefFor={openRule} />
              </Panel>
            );
          })}
        </div>

        {/* Two things the list cannot say for itself: a rule only reaches
            forward, and none of it is stored yet. */}
        <p className="mt-5 flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-subtle">
          <Icon name="clock" size={13} className="mt-0.5 shrink-0" />A rule shapes the next draft,
          never one already written. Plans already on record keep the rules they were drafted under
          until they are drafted again.
        </p>
      </PageBody>

      <OverlayHost params={params} pathname={PATH} />
    </>
  );
}
