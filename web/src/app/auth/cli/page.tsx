import type { Metadata } from 'next';
import { AuthFrame } from '@/components/app/auth-frame';
import { CliApproval } from '@/components/app/cli-approval';
import { getCurrentProject } from '@/lib/data';

export const metadata: Metadata = {
  title: 'Approve the CLI — GritQA',
  robots: { index: false },
};

export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; project?: string }>;
}) {
  const { code, project } = await searchParams;
  const clean = (code ?? 'GRIT-4K2P')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 12);

  return (
    <AuthFrame note="Device approval goes live with CLI sign-in in the beta.">
      <CliApproval
        code={clean || 'GRIT-4K2P'}
        project={project ?? (await getCurrentProject()).name}
      />
    </AuthFrame>
  );
}
