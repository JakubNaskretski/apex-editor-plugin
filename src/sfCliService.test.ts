import { describe, expect, it } from 'vitest';
import { SfCliService, OrgInfo } from './sfCliService';

const org = (o: Partial<OrgInfo>): OrgInfo => ({
  username: 'u@example.com', orgId: '00D', instanceUrl: '', ...o
});

describe('SfCliService.kindOf / isLikelyProduction', () => {
  it('classifies scratch and sandbox from their bucket flags', () => {
    expect(SfCliService.kindOf(org({ isScratch: true }))).toBe('scratch');
    expect(SfCliService.kindOf(org({ isSandbox: true }))).toBe('sandbox');
    expect(SfCliService.isLikelyProduction(org({ isScratch: true }))).toBe(false);
    expect(SfCliService.isLikelyProduction(org({ isSandbox: true }))).toBe(false);
  });

  it('classifies sandbox / scratch from the My Domain host', () => {
    expect(SfCliService.kindOf(org({ instanceUrl: 'https://acme--dev.sandbox.my.salesforce.com' }))).toBe('sandbox');
    expect(SfCliService.kindOf(org({ instanceUrl: 'https://efficiency-ability-1234.scratch.my.salesforce.com' }))).toBe('scratch');
    expect(SfCliService.kindOf(org({ instanceUrl: 'https://test.salesforce.com' }))).toBe('sandbox');
  });

  it('treats a real non-sandbox/scratch host as production (over-warn)', () => {
    expect(SfCliService.kindOf(org({ instanceUrl: 'https://acme.my.salesforce.com' }))).toBe('prod');
    expect(SfCliService.kindOf(org({ instanceUrl: 'https://ap5.salesforce.com' }))).toBe('prod');
    expect(SfCliService.isLikelyProduction(org({ instanceUrl: 'https://acme.my.salesforce.com' }))).toBe(true);
  });

  it('returns other / false for an undefined org', () => {
    expect(SfCliService.kindOf(undefined)).toBe('other');
    expect(SfCliService.isLikelyProduction(undefined)).toBe(false);
  });
});
