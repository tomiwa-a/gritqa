import { rules } from '@/lib/mock/data';
import type { TestingRule } from '@/lib/mock/types';

export async function getRules(): Promise<TestingRule[]> {
  return rules;
}
