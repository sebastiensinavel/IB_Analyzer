/** IB day (New York) of a `when` stamped UTC (see ib-parsers' common.ts). */
export function dayOf(when: string): string {
  return when.slice(0, 10);
}
