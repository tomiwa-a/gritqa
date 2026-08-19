import { period } from '@/lib/mock/data';

/** The previous window's figures, for the deltas on the overview. */
export type Period = typeof period;

export async function getPeriod(): Promise<Period> {
  return period;
}
