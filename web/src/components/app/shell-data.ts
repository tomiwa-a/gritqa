import type { Project, User } from '@/lib/model';

/**
 * What the shell is allowed to know about the developer and their projects.
 *
 * Every field here is serialized into the payload of every dashboard page, because
 * that is what passing a prop to a client component means. While these were mock
 * constants it only cost bytes. Now that `getUser()` reads Postgres, the difference
 * is whether a developer's email, avatar URL, model-key state and the absolute
 * filesystem path of every project they own travel to the browser on every single
 * navigation. The nav renders none of it, so the nav does not receive it.
 *
 * `Pick` rather than fresh shapes, so a rename in the read model still breaks here
 * instead of quietly leaving a stale duplicate behind.
 */
export type ShellUser = Pick<User, 'name' | 'email' | 'provider'>;
export type ShellProject = Pick<Project, 'publicId' | 'name' | 'status' | 'lastIndexedLabel'>;
export type ShellCurrentProject = Pick<Project, 'publicId' | 'name' | 'defaultBranch'>;

export type ShellData = {
  user: ShellUser;
  projects: ShellProject[];
  currentProject: ShellCurrentProject;
  /** Drives the badge on Review queue — the one count the nav carries. */
  reviewCount: number;
};

/** The projection, kept beside the type so the two cannot drift apart. */
export function shellDataOf(input: {
  user: User;
  projects: Project[];
  currentProject: Project;
  reviewCount: number;
}): ShellData {
  return {
    user: {
      name: input.user.name,
      email: input.user.email,
      provider: input.user.provider,
    },
    projects: input.projects.map((project) => ({
      publicId: project.publicId,
      name: project.name,
      status: project.status,
      lastIndexedLabel: project.lastIndexedLabel,
    })),
    currentProject: {
      publicId: input.currentProject.publicId,
      name: input.currentProject.name,
      defaultBranch: input.currentProject.defaultBranch,
    },
    reviewCount: input.reviewCount,
  };
}
