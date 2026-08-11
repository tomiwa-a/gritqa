import Link from 'next/link';
import { Topbar } from './topbar';
import { PageBody } from './page-body';
import { AppPageHeader } from './page-header';
import { EmptyState } from './empty-state';
import { buttonVariants } from '@/components/ui/button';
import type { IconName } from '@/components/ui/icon';

export function StubPage({
  icon,
  nav,
  title,
  description,
  next,
}: {
  icon: IconName;
  nav: string;
  title: string;
  description: string;
  next: string;
}) {
  return (
    <>
      <Topbar icon={icon} title={nav} />
      <PageBody>
        <AppPageHeader title={title} description={description} />
        <EmptyState
          className="mt-5"
          icon={icon}
          title="This screen is next up"
          description={next}
          action={
            <Link href="/dashboard" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Back to overview
            </Link>
          }
        />
      </PageBody>
    </>
  );
}
