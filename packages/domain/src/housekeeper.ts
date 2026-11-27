/** A team member who cleans cottages (docs/domain-model.md §3). Both `stableFirst` and `reserve` → invalid (R10). */
export interface Housekeeper {
  readonly id: string;
  readonly displayName: string;
  /** R7a, set by the manager. */
  readonly stableFirst: boolean;
  /** R10b, set by the manager. */
  readonly reserve: boolean;
  readonly active: boolean;
}
