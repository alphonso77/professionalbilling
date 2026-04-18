exports.seed = async function (knex) {
  const payload = {
    categories: [
      {
        key: 'time-tracking',
        title: 'Time Tracking',
        description: 'Log billable hours against clients.',
        entries: [
          {
            key: 'time-entry-client-assignment',
            label: 'Assigning a client to a time entry',
            tooltip: "Time entries without a client won't be automatically invoiced.",
            detail:
              'Every billable hour should be linked to a client so the invoicing pipeline can pick it up. You can still log hours without a client, but no automated processing will occur.',
            docSlug: 'time-tracking/client-assignment',
            whatWeMeasure:
              'Time entries grouped by client_id, summed into the next invoice cycle.',
          },
        ],
      },
      {
        key: 'invoicing',
        title: 'Invoicing',
        description: 'Generate and send invoices via Stripe or PDF.',
        entries: [],
      },
      {
        key: 'accounts-receivable',
        title: 'Accounts Receivable Automation',
        description:
          'Schedule invoice drafts from unbilled time entries and fire reminders on a cadence.',
        entries: [
          {
            key: 'ar.automation.enabled',
            label: 'AR automation',
            tooltip:
              'Master switch. When off, the scheduler skips this org entirely and no reminders fire.',
            detail:
              'Turning AR automation on lets the daily scheduler build draft invoices from each client\'s unbilled time entries on the day of month you choose. You can still run it on demand from this page.',
            docSlug: 'ar/automation',
          },
          {
            key: 'ar.automation.scope',
            label: 'Automation scope',
            tooltip:
              'Global applies one setting to every client. Per-client lets each client opt-in or override individual fields.',
            detail:
              'In global mode every client follows the org settings below. In per-client mode, the org values act as defaults — any client-level override (on the client edit modal) takes precedence for that client.',
            docSlug: 'ar/scope',
          },
          {
            key: 'ar.automation.run_day',
            label: 'Run day of month',
            tooltip:
              'The scheduler fires once per month on this day (1–28). Pick a day your team wants invoices drafted.',
            detail:
              'The AR scheduler runs daily at 09:00 UTC and checks which orgs are due today. A day past 28 isn\'t supported because February does not have one — use 28 or earlier.',
            docSlug: 'ar/run-day',
          },
          {
            key: 'ar.automation.approval',
            label: 'Require approval',
            tooltip:
              'When on, drafts wait in a pending-approval queue for a human to approve before they send.',
            detail:
              'Approval gating lets a human review auto-generated drafts before they\'re finalized and emailed. Turn it off to fully automate the pipeline — drafts are immediately finalized and the invoice email is enqueued.',
            docSlug: 'ar/approval',
          },
          {
            key: 'ar.reminders.cadence',
            label: 'Reminder cadence',
            tooltip:
              'Enter a number of days. Reminders fire at N, 2N, 3N, ... days past the original send.',
            detail:
              'Reminders are sent on a strict multiple of the cadence. Setting cadence to 7 fires reminder 1 at 7 days, reminder 2 at 14, reminder 3 at 21, and so on until the invoice is paid or voided.',
            docSlug: 'ar/reminders',
          },
          {
            key: 'ar.run_now',
            label: 'Run Now',
            tooltip:
              'Executes the full AR pass against your org right now — creates drafts, finalizes/sends if approval is off, and fires any due reminders.',
            detail:
              'Run Now respects all the rules the scheduler uses, including demo-safety (seeded clients and example.com addresses never get real email). Use this to test your settings or catch up if a scheduled run was missed.',
            docSlug: 'ar/run-now',
          },
          {
            key: 'ar.preview',
            label: 'Preview',
            tooltip:
              'A dry-run computation — shows what the next AR pass would create right now. Does not write anything.',
            detail:
              'Preview refreshes whenever you change settings. The "would create" and "would fire reminders" tables reflect exactly what Run Now would do if you clicked it this instant.',
            docSlug: 'ar/preview',
          },
        ],
      },
    ],
  };
  await knex.raw(
    'INSERT INTO corporate.docs_registry (id, data) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()',
    [JSON.stringify(payload)]
  );
};
