import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../openapi/registry';
import { tdb } from '../config/tenant-context';
import { AppError } from '../middleware/error-handler';
import { tenantScope } from '../middleware/tenant-scope';
import type { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

const ClientSchema = z
  .object({
    id: z.string().uuid(),
    org_id: z.string().uuid(),
    name: z.string(),
    email: z.string().nullable(),
    billing_address: z.string().nullable(),
    notes: z.string().nullable(),
    default_rate_cents: z.number().int().nullable(),
    arAutomationEnabled: z.boolean().nullable(),
    arApprovalRequired: z.boolean().nullable(),
    arRemindersEnabled: z.boolean().nullable(),
    arReminderCadenceDays: z.number().int().positive().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Client');

const CreateClientBody = z
  .object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    billing_address: z.string().optional(),
    notes: z.string().optional(),
    default_rate_cents: z.number().int().min(0).nullable().optional(),
  })
  .openapi('CreateClientBody');

const UpdateClientBody = z
  .object({
    name: z.string().min(1).optional(),
    email: z.string().email().nullable().optional(),
    billing_address: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    default_rate_cents: z.number().int().min(0).nullable().optional(),
    arAutomationEnabled: z.boolean().nullable().optional(),
    arApprovalRequired: z.boolean().nullable().optional(),
    arRemindersEnabled: z.boolean().nullable().optional(),
    arReminderCadenceDays: z.number().int().positive().nullable().optional(),
  })
  .openapi('UpdateClientBody');

const ListResponse = z.object({ data: z.array(ClientSchema) });
const OneResponse = z.object({ data: ClientSchema });
const DeleteResponse = z.object({ data: z.object({ id: z.string().uuid() }) });

registry.registerPath({
  method: 'get',
  path: '/api/clients',
  tags: ['clients'],
  summary: 'List clients for the current org',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  responses: {
    200: { description: 'Clients', content: { 'application/json': { schema: ListResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/clients/{id}',
  tags: ['clients'],
  summary: 'Get a client',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: 'Client', content: { 'application/json': { schema: OneResponse } } },
    404: { description: 'Not found' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/clients',
  tags: ['clients'],
  summary: 'Create a client',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { body: { content: { 'application/json': { schema: CreateClientBody } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: OneResponse } } },
    400: { description: 'Validation error' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/clients/{id}',
  tags: ['clients'],
  summary: 'Update a client',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { 'application/json': { schema: UpdateClientBody } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: OneResponse } } },
    400: { description: 'Validation error' },
    404: { description: 'Not found' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/clients/{id}',
  tags: ['clients'],
  summary: 'Delete a client',
  description:
    'Plain delete refuses with 409 if the client has any invoices or time entries (FK RESTRICT on invoices.client_id would otherwise 500). Pass `?force=true` to cascade-delete invoices + time entries along with the client — only allowed when the client was created by the seed tool (`seeded_at IS NOT NULL`).',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({
      force: z
        .enum(['true', 'false'])
        .optional()
        .openapi({
          description:
            'Cascade-delete invoices and time entries referencing this client. Only allowed for seeded clients.',
        }),
    }),
  },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: DeleteResponse } } },
    400: { description: 'force=true not allowed on non-seeded client (code: FORCE_NOT_ALLOWED)' },
    404: { description: 'Not found' },
    409: {
      description:
        'Client has invoices or time entries; plain delete refused (code: CLIENT_HAS_HISTORY)',
    },
  },
});

const CLIENT_COLUMNS = [
  'id',
  'org_id',
  'name',
  'email',
  'billing_address',
  'notes',
  'default_rate_cents',
  'ar_automation_enabled',
  'ar_approval_required',
  'ar_reminders_enabled',
  'ar_reminder_cadence_days',
  'created_at',
  'updated_at',
];

type ClientRow = {
  id: string;
  org_id: string;
  name: string;
  email: string | null;
  billing_address: string | null;
  notes: string | null;
  default_rate_cents: number | null;
  ar_automation_enabled: boolean | null;
  ar_approval_required: boolean | null;
  ar_reminders_enabled: boolean | null;
  ar_reminder_cadence_days: number | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function serializeClient(row: ClientRow) {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    email: row.email,
    billing_address: row.billing_address,
    notes: row.notes,
    default_rate_cents: row.default_rate_cents,
    arAutomationEnabled: row.ar_automation_enabled,
    arApprovalRequired: row.ar_approval_required,
    arRemindersEnabled: row.ar_reminders_enabled,
    arReminderCadenceDays:
      row.ar_reminder_cadence_days == null
        ? null
        : Number(row.ar_reminder_cadence_days),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function handleList() {
  const rows = (await tdb('clients')
    .select(CLIENT_COLUMNS)
    .orderBy('created_at', 'desc')) as ClientRow[];
  return { data: rows.map(serializeClient) };
}

export async function handleGet(req: AuthenticatedRequest) {
  const id = z.string().uuid().parse(req.params.id);
  const row = (await tdb('clients')
    .where({ id })
    .select(CLIENT_COLUMNS)
    .first()) as ClientRow | undefined;
  if (!row) throw new AppError(404, 'Client not found');
  return { data: serializeClient(row) };
}

export async function handleCreate(req: AuthenticatedRequest) {
  const body = CreateClientBody.parse(req.body);
  const [row] = (await tdb('clients')
    .insert({
      org_id: req.org!.id,
      name: body.name,
      email: body.email ?? null,
      billing_address: body.billing_address ?? null,
      notes: body.notes ?? null,
      default_rate_cents: body.default_rate_cents ?? null,
    })
    .returning(CLIENT_COLUMNS)) as ClientRow[];
  return { data: serializeClient(row) };
}

export async function handleUpdate(req: AuthenticatedRequest) {
  const id = z.string().uuid().parse(req.params.id);
  const body = UpdateClientBody.parse(req.body);
  const patch: Record<string, unknown> = {};
  for (const k of [
    'name',
    'email',
    'billing_address',
    'notes',
    'default_rate_cents',
  ] as const) {
    if (k in body) patch[k] = body[k];
  }
  if ('arAutomationEnabled' in body) patch.ar_automation_enabled = body.arAutomationEnabled;
  if ('arApprovalRequired' in body) patch.ar_approval_required = body.arApprovalRequired;
  if ('arRemindersEnabled' in body) patch.ar_reminders_enabled = body.arRemindersEnabled;
  if ('arReminderCadenceDays' in body) patch.ar_reminder_cadence_days = body.arReminderCadenceDays;

  if (Object.keys(patch).length === 0) {
    const row = (await tdb('clients')
      .where({ id })
      .select(CLIENT_COLUMNS)
      .first()) as ClientRow | undefined;
    if (!row) throw new AppError(404, 'Client not found');
    return { data: serializeClient(row) };
  }
  const rows = (await tdb('clients')
    .where({ id })
    .update(patch)
    .returning(CLIENT_COLUMNS)) as ClientRow[];
  if (!rows.length) throw new AppError(404, 'Client not found');
  return { data: serializeClient(rows[0]) };
}

export async function handleDelete(req: AuthenticatedRequest) {
  const id = z.string().uuid().parse(req.params.id);
  const force = req.query.force === 'true';

  const client = (await tdb('clients')
    .where({ id })
    .select('id', 'org_id', 'seeded_at')
    .first()) as { id: string; org_id: string; seeded_at: string | null } | undefined;
  if (!client) throw new AppError(404, 'Client not found');

  if (force && !client.seeded_at) {
    throw new AppError(
      400,
      'force=true is only allowed on seeded clients',
      'FORCE_NOT_ALLOWED'
    );
  }

  const invoiceRows = (await tdb('invoices').where({ client_id: id }).select('id')) as Array<{
    id: string;
  }>;
  const timeEntryRows = (await tdb('time_entries')
    .where({ client_id: id })
    .select('id')) as Array<{ id: string }>;
  const invoiceCount = invoiceRows.length;
  const timeEntryCount = timeEntryRows.length;

  if (!force && (invoiceCount > 0 || timeEntryCount > 0)) {
    const parts: string[] = [];
    if (invoiceCount > 0) {
      parts.push(`${invoiceCount} ${invoiceCount === 1 ? 'invoice' : 'invoices'}`);
    }
    if (timeEntryCount > 0) {
      parts.push(
        `${timeEntryCount} ${timeEntryCount === 1 ? 'time entry' : 'time entries'}`
      );
    }
    const subject = client.seeded_at ? 'This client' : 'Client';
    const suffix = client.seeded_at
      ? " Use the 'Clean Slate' option in the Seed modal to remove demo data."
      : ' Delete or reassign them first.';
    throw new AppError(
      409,
      `${subject} has ${parts.join(' and ')}.${suffix}`,
      'CLIENT_HAS_HISTORY'
    );
  }

  if (force) {
    const invDeleted =
      invoiceCount > 0 ? await tdb('invoices').where({ client_id: id }).del() : 0;
    const teDeleted =
      timeEntryCount > 0 ? await tdb('time_entries').where({ client_id: id }).del() : 0;

    if (invoiceRows.length > 0) {
      await tdb('audit_log')
        .where({ org_id: client.org_id })
        .whereIn('source', ['invoice.send', 'invoice-email'])
        .whereIn('external_id', invoiceRows.map((r) => r.id))
        .del();
    }

    await tdb('audit_log').insert({
      source: 'client.delete',
      org_id: client.org_id,
      event_type: 'client.cascade.invoices',
      external_id: id,
      status: 'processed',
      payload: { invoice_ids: invoiceRows.map((r) => r.id), count: Number(invDeleted) },
    });
    await tdb('audit_log').insert({
      source: 'client.delete',
      org_id: client.org_id,
      event_type: 'client.cascade.time_entries',
      external_id: id,
      status: 'processed',
      payload: {
        time_entry_ids: timeEntryRows.map((r) => r.id),
        count: Number(teDeleted),
      },
    });
  }

  const deleted = await tdb('clients').where({ id }).del();
  if (!deleted) throw new AppError(404, 'Client not found');

  if (force) {
    await tdb('audit_log').insert({
      source: 'client.delete',
      org_id: client.org_id,
      event_type: 'client.force_delete',
      external_id: id,
      status: 'processed',
      payload: { seeded: true },
    });
  }

  return { data: { id } };
}

router.get(
  '/',
  tenantScope(async (_req, res) => {
    res.json(await handleList());
  })
);

router.get(
  '/:id',
  tenantScope(async (req, res) => {
    res.json(await handleGet(req));
  })
);

router.post(
  '/',
  tenantScope(async (req, res) => {
    const result = await handleCreate(req);
    res.status(201).json(result);
  })
);

router.patch(
  '/:id',
  tenantScope(async (req, res) => {
    res.json(await handleUpdate(req));
  })
);

router.delete(
  '/:id',
  tenantScope(async (req, res) => {
    res.json(await handleDelete(req));
  })
);

export default router;
export { CreateClientBody, UpdateClientBody };
