import { expect } from 'chai';

import { UpdateArSettingsBody } from '../../../src/routes/ar-settings';

describe('routes/ar-settings — UpdateArSettingsBody', () => {
  it('accepts an empty patch', () => {
    expect(UpdateArSettingsBody.safeParse({}).success).to.equal(true);
  });

  it('accepts a partial patch of the flag columns', () => {
    const r = UpdateArSettingsBody.safeParse({
      automationEnabled: true,
      remindersEnabled: true,
      reminderCadenceDays: 7,
    });
    expect(r.success).to.equal(true);
  });

  it('rejects reminderCadenceDays of 0', () => {
    const r = UpdateArSettingsBody.safeParse({ reminderCadenceDays: 0 });
    expect(r.success).to.equal(false);
  });

  it('rejects negative reminderCadenceDays', () => {
    const r = UpdateArSettingsBody.safeParse({ reminderCadenceDays: -7 });
    expect(r.success).to.equal(false);
  });

  it('rejects non-integer reminderCadenceDays', () => {
    const r = UpdateArSettingsBody.safeParse({ reminderCadenceDays: 7.5 });
    expect(r.success).to.equal(false);
  });

  it('rejects runDayOfMonth below 1', () => {
    const r = UpdateArSettingsBody.safeParse({ runDayOfMonth: 0 });
    expect(r.success).to.equal(false);
  });

  it('rejects runDayOfMonth above 28', () => {
    const r = UpdateArSettingsBody.safeParse({ runDayOfMonth: 29 });
    expect(r.success).to.equal(false);
  });

  it('accepts runDayOfMonth at the boundaries', () => {
    expect(UpdateArSettingsBody.safeParse({ runDayOfMonth: 1 }).success).to.equal(true);
    expect(UpdateArSettingsBody.safeParse({ runDayOfMonth: 28 }).success).to.equal(true);
  });

  it('rejects an unknown scope value', () => {
    const r = UpdateArSettingsBody.safeParse({ scope: 'weekly' as unknown as 'global' });
    expect(r.success).to.equal(false);
  });

  it('accepts both valid scope values', () => {
    expect(UpdateArSettingsBody.safeParse({ scope: 'global' }).success).to.equal(true);
    expect(UpdateArSettingsBody.safeParse({ scope: 'per_client' }).success).to.equal(true);
  });
});
