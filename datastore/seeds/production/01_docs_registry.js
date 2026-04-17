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
    ],
  };
  await knex.raw(
    'INSERT INTO corporate.docs_registry (id, data) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()',
    [JSON.stringify(payload)]
  );
};
