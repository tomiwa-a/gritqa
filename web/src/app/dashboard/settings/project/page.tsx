import Link from 'next/link';
import { SettingsShell } from '@/components/app/settings/settings-shell';
import { SettingRow } from '@/components/app/settings/setting-row';
import { ProjectFields } from '@/components/app/settings/project-fields';
import { DangerZone } from '@/components/app/settings/danger-zone';
import { Panel } from '@/components/app/panel';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { getCurrentProjectOrNull } from '@/lib/data';
import { EmptyState } from '@/components/app/empty-state';

export const metadata = { title: 'Project · Settings · GritQA' };

export default async function ProjectSettingsPage() {
  const currentProject = await getCurrentProjectOrNull();
  if (!currentProject) {
    return (
      <SettingsShell
        active="project"
        title="Project"
        description="How GritQA finds this project and what it watches. The path and the reading are set by the CLI on your machine."
      >
        <EmptyState
          icon="projects"
          title="Create a project first"
          description="Run the CLI once in your project folder and approve the pairing — then its settings land here."
          action={
            <Link
              href="/dashboard/setup"
              className={buttonVariants({ variant: 'accent', size: 'sm' })}
            >
              Connect your first repo
              <Icon name="arrowRight" size={13} />
            </Link>
          }
        />
      </SettingsShell>
    );
  }
  return (
    <SettingsShell
      active="project"
      title={currentProject.name}
      description="How GritQA finds this project and what it watches. The path and the reading are set by the CLI on your machine."
      action={
        <Link
          href="/dashboard/projects"
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          All projects
          <Icon name="arrowRight" size={13} />
        </Link>
      }
    >
      <Panel title="Details" bodyClassName="p-0">
        <ProjectFields name={currentProject.name} branch={currentProject.defaultBranch} />
        <SettingRow
          label="Where it lives"
          hint="Written by the CLI the first time you ran it in that folder."
          value={currentProject.localPath}
          mono
        />
        <SettingRow label="Repository" value={currentProject.repoUrl ?? 'Not linked'} mono />
        <SettingRow label="Project ID" value={currentProject.publicId} mono />
      </Panel>

      <Panel
        title="What the CLI has read"
        subtitle={
          currentProject.lastIndexedLabel
            ? `Last read ${currentProject.lastIndexedLabel}`
            : 'Not read yet'
        }
        bodyClassName="p-0"
      >
        <div className="grid grid-cols-2 gap-px border-b border-rule-soft bg-rule-soft sm:grid-cols-3">
          {[
            { value: currentProject.fileCount, label: 'files tracked' },
            { value: currentProject.endpointCount, label: 'endpoints found' },
            { value: 'Go', label: 'language' },
          ].map((cell) => (
            <div key={cell.label} className="bg-app-panel px-4 py-3.5">
              <p className="nums text-[20px] leading-none font-semibold tracking-[-0.02em] text-ink">
                {cell.value}
              </p>
              <p className="mt-1.5 text-[11.5px] text-ink-subtle">{cell.label}</p>
            </div>
          ))}
        </div>

        <SettingRow
          label="Read it again"
          hint="Runs on your machine, so the CLI has to be the one to do it — this asks it to."
          control={
            <Button variant="secondary" size="sm">
              <Icon name="refresh" size={13} />
              Ask for a fresh read
            </Button>
          }
        />
      </Panel>

      <DangerZone title="Stop using this project">
        <SettingRow
          label="Archive it"
          hint="Keeps every plan and run for the record, but stops drafting and stops watching the branch."
          control={
            <Button variant="secondary" size="sm">
              <Icon name="archive" size={13} />
              Archive
            </Button>
          }
        />
        <SettingRow
          label="Remove it"
          hint="Deletes the plans, runs, and everything read from this codebase. The folder on your machine is left alone."
          control={
            <Button variant="danger" size="sm">
              Remove project
            </Button>
          }
        />
      </DangerZone>
    </SettingsShell>
  );
}
