import { describe, expect, it } from 'vitest';

import * as domain from './index.js';

describe('domain package', () => {
  it('loads its public entry point', () => {
    expect(domain).toBeTypeOf('object');
  });
});
