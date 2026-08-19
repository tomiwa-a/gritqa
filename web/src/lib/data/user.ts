import { user } from '@/lib/mock/data';
import type { User } from '@/lib/mock/types';

/** The signed-in developer. Becomes a `users` row keyed off the session cookie. */
export async function getUser(): Promise<User> {
  return user;
}
