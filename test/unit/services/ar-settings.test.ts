import { expect } from 'chai';

import {
  resolveEffective,
  serializeOrgArSettings,
  type ClientArOverrides,
  type OrgArSettings,
} from '../../../src/services/ar-settings';

function orgRow(partial: Partial<OrgArSettings> = {}): OrgArSettings {
  return {
    ar_automation_enabled: true,
    ar_scope: 'global',
    ar_run_day_of_month: 1,
    ar_approval_required: true,
    ar_reminders_enabled: false,
    ar_reminder_cadence_days: 30,
    ...partial,
  };
}

function clientOverrides(partial: Partial<ClientArOverrides> = {}): ClientArOverrides {
  return {
    ar_automation_enabled: null,
    ar_approval_required: null,
    ar_reminders_enabled: null,
    ar_reminder_cadence_days: null,
    ...partial,
  };
}

describe('services/ar-settings — resolveEffective', () => {
  it('returns org defaults unchanged when scope is global', () => {
    const org = orgRow({
      ar_scope: 'global',
      ar_automation_enabled: true,
      ar_approval_required: false,
      ar_reminders_enabled: true,
      ar_reminder_cadence_days: 14,
    });
    const client = clientOverrides({
      ar_automation_enabled: false, // should be ignored in global mode
      ar_approval_required: true,
      ar_reminders_enabled: false,
      ar_reminder_cadence_days: 7,
    });

    const eff = resolveEffective(org, client);
    expect(eff).to.deep.equal({
      automationEnabled: true,
      approvalRequired: false,
      remindersEnabled: true,
      reminderCadenceDays: 14,
    });
  });

  it('returns org defaults when client is null (global or per_client)', () => {
    const org = orgRow({ ar_scope: 'per_client', ar_automation_enabled: true });
    const eff = resolveEffective(org, null);
    expect(eff.automationEnabled).to.equal(true);
  });

  it('falls back per-field to org default in per_client mode when override is null', () => {
    const org = orgRow({
      ar_scope: 'per_client',
      ar_automation_enabled: false,
      ar_approval_required: true,
      ar_reminders_enabled: false,
      ar_reminder_cadence_days: 30,
    });
    const client = clientOverrides({
      ar_automation_enabled: true,          // override on
      ar_approval_required: null,           // inherit (true)
      ar_reminders_enabled: true,           // override on
      ar_reminder_cadence_days: null,       // inherit (30)
    });

    const eff = resolveEffective(org, client);
    expect(eff).to.deep.equal({
      automationEnabled: true,
      approvalRequired: true,
      remindersEnabled: true,
      reminderCadenceDays: 30,
    });
  });

  it('respects per_client override of false even when org default is true', () => {
    const org = orgRow({
      ar_scope: 'per_client',
      ar_automation_enabled: true,
      ar_reminders_enabled: true,
    });
    const client = clientOverrides({
      ar_automation_enabled: false,
      ar_reminders_enabled: false,
    });

    const eff = resolveEffective(org, client);
    expect(eff.automationEnabled).to.equal(false);
    expect(eff.remindersEnabled).to.equal(false);
  });
});

describe('services/ar-settings — serializeOrgArSettings', () => {
  it('converts snake_case columns to camelCase response shape', () => {
    const out = serializeOrgArSettings(
      orgRow({
        ar_automation_enabled: true,
        ar_scope: 'per_client',
        ar_run_day_of_month: 15,
        ar_approval_required: false,
        ar_reminders_enabled: true,
        ar_reminder_cadence_days: 7,
      })
    );
    expect(out).to.deep.equal({
      automationEnabled: true,
      scope: 'per_client',
      runDayOfMonth: 15,
      approvalRequired: false,
      remindersEnabled: true,
      reminderCadenceDays: 7,
    });
  });

  it('coerces numeric columns that Postgres may return as strings', () => {
    const out = serializeOrgArSettings({
      ...orgRow(),
      ar_run_day_of_month: '12' as unknown as number,
      ar_reminder_cadence_days: '45' as unknown as number,
    });
    expect(out.runDayOfMonth).to.equal(12);
    expect(out.reminderCadenceDays).to.equal(45);
  });
});
