import Link from 'next/link';
import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { AppPageHeader } from '@/components/app/page-header';
import { Panel } from '@/components/app/panel';
import { PlanEditor } from '@/components/app/plan/plan-editor';
import { buttonVariants } from '@/components/ui/button';
import { NoProjectGate } from '@/components/app/no-project-gate';
import { OverlayHost } from '@/components/app/overlay-host';
import { type PageParams } from '@/lib/overlay';
import { Icon } from '@/components/ui/icon';
import { getCurrentProjectOrNull, getLastBaseUrl, getObservedRoutes } from '@/lib/data';

export const metadata = { title: 'Write a plan · GritQA' };

/**
 * A plan written by hand, from nothing.
 *
 * The same editor the edit tab renders, with no version behind it. It is a page rather
 * than an overlay because there is no plan to go back to: half a plan and a navigation
 * away from it would be a lost afternoon.
 */
export default async function NewPlanPage({ searchParams }: { searchParams: Promise<PageParams> }) {
  const params = await searchParams;
  const project = await getCurrentProjectOrNull();
  if (!project) return <NoProjectGate icon="plan" title="Write a plan" />;
  const [baseUrl, routes] = await Promise.all([getLastBaseUrl(), getObservedRoutes()]);

  return (
    <>
      <Topbar
        icon="plan"
        title="Write a plan"
        action={
          <Link
            href="/dashboard/test-plans"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Icon name="close" size={14} />
            Cancel
          </Link>
        }
      />

      <PageBody>
        <AppPageHeader
          title="A plan of your own"
          description="A plan is a few steps in order, each one checking something. Write the steps yourself here — GritQA holds it to the same rules it holds a drafted one to, so nothing that could not run gets saved."
        />

        <Panel
          title="The plan"
          subtitle="It saves as a draft, and nothing runs until you approve it"
          bodyClassName="p-4"
          className="mt-5"
        >
          <PlanEditor
            target={{ mode: 'new' }}
            baseUrl={baseUrl ?? ''}
            routes={routes}
            initial={{
              name: '',
              description: '',
              variables: {},
              covers: [],
              steps: [],
              assumptions: [],
            }}
          />
        </Panel>
      </PageBody>
      <OverlayHost params={params} pathname="/dashboard/test-plans/new" />
    </>
  );
}
