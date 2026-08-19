import { currentProject, projects } from '@/lib/mock/data';
import type { Project } from '@/lib/mock/types';

export async function getProjects(): Promise<Project[]> {
  return projects;
}

/**
 * The project every other read is scoped to. Currently the first one; becomes a
 * column on the session, so this is the one read the rest of them depend on.
 */
export async function getCurrentProject(): Promise<Project> {
  return currentProject;
}
