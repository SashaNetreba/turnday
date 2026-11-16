export type CottageType = 'STABLE' | 'PREMIUM';

export interface Cottage {
  readonly number: number;
  readonly type: CottageType;
  readonly schedulable: boolean;
  readonly note?: string;
}
