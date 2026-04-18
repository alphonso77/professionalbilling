/**
 * Phase 2C — effective AR settings resolution.
 *
 * Org rows carry the master + defaults. Clients carry nullable overrides.
 * When scope='global', client overrides are ignored entirely. When
 * scope='per_client', each field falls back to the org default if the
 * client-level value is NULL.
 */

export type ArScope = 'global' | 'per_client';

export interface OrgArSettings {
  ar_automation_enabled: boolean;
  ar_scope: ArScope;
  ar_run_day_of_month: number;
  ar_approval_required: boolean;
  ar_reminders_enabled: boolean;
  ar_reminder_cadence_days: number;
}

export interface ClientArOverrides {
  ar_automation_enabled: boolean | null;
  ar_approval_required: boolean | null;
  ar_reminders_enabled: boolean | null;
  ar_reminder_cadence_days: number | null;
}

export interface EffectiveArSettings {
  automationEnabled: boolean;
  approvalRequired: boolean;
  remindersEnabled: boolean;
  reminderCadenceDays: number;
}

export function resolveEffective(
  org: OrgArSettings,
  client: ClientArOverrides | null
): EffectiveArSettings {
  if (org.ar_scope === 'global' || client === null) {
    return {
      automationEnabled: org.ar_automation_enabled,
      approvalRequired: org.ar_approval_required,
      remindersEnabled: org.ar_reminders_enabled,
      reminderCadenceDays: org.ar_reminder_cadence_days,
    };
  }
  return {
    automationEnabled: client.ar_automation_enabled ?? org.ar_automation_enabled,
    approvalRequired: client.ar_approval_required ?? org.ar_approval_required,
    remindersEnabled: client.ar_reminders_enabled ?? org.ar_reminders_enabled,
    reminderCadenceDays:
      client.ar_reminder_cadence_days ?? org.ar_reminder_cadence_days,
  };
}

export function serializeOrgArSettings(row: OrgArSettings) {
  return {
    automationEnabled: row.ar_automation_enabled,
    scope: row.ar_scope,
    runDayOfMonth: Number(row.ar_run_day_of_month),
    approvalRequired: row.ar_approval_required,
    remindersEnabled: row.ar_reminders_enabled,
    reminderCadenceDays: Number(row.ar_reminder_cadence_days),
  };
}

export const ORG_AR_COLUMNS = [
  'ar_automation_enabled',
  'ar_scope',
  'ar_run_day_of_month',
  'ar_approval_required',
  'ar_reminders_enabled',
  'ar_reminder_cadence_days',
] as const;

export const CLIENT_AR_COLUMNS = [
  'ar_automation_enabled',
  'ar_approval_required',
  'ar_reminders_enabled',
  'ar_reminder_cadence_days',
] as const;
