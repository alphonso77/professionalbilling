import { Router } from 'express';
import { z } from 'zod';

import { registry } from '../openapi/registry';
import { env } from '../config/env';
import { tenantScope } from '../middleware/tenant-scope';
import {
  createDraft,
  deleteDraft,
  finalizeInvoice,
  getInvoiceWithItems,
  listInvoices,
  serializeInvoice,
  serializeLineItem,
  updateDraft,
  voidInvoice,
} from '../services/invoices';
import { ensurePaymentIntent } from '../services/ensure-payment-intent';
import { tdb } from '../config/tenant-context';
import { getInvoiceEmailQueue } from '../config/queues';
import { AppError } from '../middleware/error-handler';

const router = Router();

const InvoiceStatusEnum = z.enum(['draft', 'open', 'paid', 'void']);

const InvoiceSchema = z
  .object({
    id: z.string().uuid(),
    orgId: z.string().uuid(),
    clientId: z.string().uuid(),
    number: z.string().nullable(),
    status: InvoiceStatusEnum,
    issueDate: z.string().nullable(),
    dueDate: z.string().nullable(),
    subtotalCents: z.number().int(),
    totalCents: z.number().int(),
    notes: z.string().nullable(),
    stripePaymentIntentId: z.string().nullable(),
    stripeClientSecret: z.string().nullable(),
    paidAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Invoice');

const InvoiceLineItemSchema = z
  .object({
    id: z.string().uuid(),
    invoiceId: z.string().uuid(),
    timeEntryId: z.string().uuid().nullable(),
    description: z.string(),
    quantityHours: z.number(),
    rateCents: z.number().int(),
    amountCents: z.number().int(),
    createdAt: z.string(),
  })
  .openapi('InvoiceLineItem');

const InvoiceWithItemsSchema = InvoiceSchema.extend({
  lineItems: z.array(InvoiceLineItemSchema),
  client: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().nullable(),
  }),
  stripePublishableKey: z.string().optional(),
  connectedAccountId: z.string().optional(),
  paymentUrl: z.string().optional(),
  paymentUnavailableReason: z.literal('seed_requires_test_mode').optional(),
}).openapi('InvoiceWithItems');

const ListQuery = z.object({
  status: InvoiceStatusEnum.optional(),
  clientId: z.string().uuid().optional(),
});

const CreateBody = z
  .object({
    clientId: z.string().uuid(),
    timeEntryIds: z.array(z.string().uuid()).min(1),
    dueDate: z.string().optional(),
    notes: z.string().optional(),
  })
  .openapi('CreateInvoiceBody');

const UpdateBody = z
  .object({
    dueDate: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    removeLineItemIds: z.array(z.string().uuid()).optional(),
  })
  .openapi('UpdateInvoiceBody');

const IdParam = z.object({ id: z.string().uuid() });

const ListResponse = z.object({ data: z.array(InvoiceSchema) });
const OneResponse = z.object({ data: InvoiceSchema });
const OneWithItemsResponse = z.object({ data: InvoiceWithItemsSchema });
const DeleteResponse = z.object({ data: z.object({ id: z.string().uuid() }) });

registry.registerPath({
  method: 'get',
  path: '/api/invoices',
  tags: ['invoices'],
  summary: 'List invoices for the current org',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { query: ListQuery },
  responses: {
    200: { description: 'Invoices', content: { 'application/json': { schema: ListResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/invoices/{id}',
  tags: ['invoices'],
  summary: 'Get an invoice with its line items',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Invoice', content: { 'application/json': { schema: OneWithItemsResponse } } },
    404: { description: 'Not found' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/invoices',
  tags: ['invoices'],
  summary: 'Create a draft invoice from unbilled time entries',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { body: { content: { 'application/json': { schema: CreateBody } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: OneWithItemsResponse } } },
    400: { description: 'Validation error / time entries invalid' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/invoices/{id}',
  tags: ['invoices'],
  summary: 'Update a draft invoice',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: UpdateBody } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: OneWithItemsResponse } } },
    409: { description: 'Not a draft' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/invoices/{id}/finalize',
  tags: ['invoices'],
  summary: 'Finalize a draft invoice (assign number; PI is created lazily on first view)',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Finalized', content: { 'application/json': { schema: OneWithItemsResponse } } },
    400: { description: 'Invoice total must be greater than zero' },
    409: { description: 'Not a draft' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/invoices/{id}/send',
  tags: ['invoices'],
  summary: 'Enqueue an email to the client (skipped for seeded/example-domain invoices)',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Queued (or skipped with a warning for seeded/demo invoices)',
      content: { 'application/json': { schema: OneResponse } },
    },
    409: { description: 'Not open' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/invoices/{id}/void',
  tags: ['invoices'],
  summary: 'Void an invoice (cancels PaymentIntent if present)',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Voided', content: { 'application/json': { schema: OneResponse } } },
    409: { description: 'Already paid' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/invoices/{id}',
  tags: ['invoices'],
  summary: 'Delete a draft invoice',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: DeleteResponse } } },
    409: { description: 'Not a draft' },
  },
});

/** Build the detail payload, stripping/augmenting credentials per status. */
function buildDetailPayload(
  invoice: ReturnType<typeof serializeInvoice>,
  lineItems: ReturnType<typeof serializeLineItem>[],
  client: { id: string; name: string; email: string | null },
  connectedAccountId: string | null,
  paymentToken: string | null = null,
  paymentUnavailableReason: 'seed_requires_test_mode' | null = null
) {
  const payload: Record<string, unknown> = {
    ...invoice,
    lineItems,
    client,
  };

  if (invoice.status !== 'open') {
    payload.stripeClientSecret = null;
  } else {
    if (env.STRIPE_PUBLISHABLE_KEY) {
      payload.stripePublishableKey = env.STRIPE_PUBLISHABLE_KEY;
    }
    if (connectedAccountId) payload.connectedAccountId = connectedAccountId;
    if (paymentToken && env.FRONTEND_URL) {
      payload.paymentUrl = `${env.FRONTEND_URL}/pay/${invoice.id}?token=${paymentToken}`;
    }
    if (paymentUnavailableReason) {
      payload.paymentUnavailableReason = paymentUnavailableReason;
      payload.stripeClientSecret = null;
    }
  }

  return payload;
}

export async function handleList(
  query: z.infer<typeof ListQuery>,
  t = tdb
) {
  return { data: await listInvoices(query, t) };
}

export async function handleGet(id: string, t = tdb) {
  const { invoice, items, client } = await getInvoiceWithItems(id, t);

  let paymentUnavailableReason: 'seed_requires_test_mode' | null = null;
  if (invoice.status === 'open' && !invoice.stripe_payment_intent_id) {
    try {
      const ensured = await ensurePaymentIntent(id, t);
      invoice.stripe_payment_intent_id = ensured.paymentIntentId;
      invoice.stripe_client_secret = ensured.clientSecret;
    } catch (err) {
      if (err instanceof AppError && err.code === 'SEED_REQUIRES_TEST_MODE') {
        paymentUnavailableReason = 'seed_requires_test_mode';
      } else {
        throw err;
      }
    }
  }

  let connectedAccountId: string | null = null;
  if (invoice.status === 'open') {
    const platform = (await t('platforms')
      .where({ type: 'stripe' })
      .select('external_account_id')
      .first()) as { external_account_id: string | null } | undefined;
    connectedAccountId = platform?.external_account_id ?? null;
  }
  return {
    data: buildDetailPayload(
      serializeInvoice(invoice),
      items.map(serializeLineItem),
      client,
      connectedAccountId,
      invoice.payment_token,
      paymentUnavailableReason
    ),
  };
}

export async function handleCreate(body: z.infer<typeof CreateBody>, orgId: string, t = tdb) {
  const { invoice, items, client } = await createDraft(body, orgId, t);
  return {
    data: buildDetailPayload(
      serializeInvoice(invoice),
      items.map(serializeLineItem),
      client,
      null
    ),
  };
}

export async function handleUpdate(id: string, body: z.infer<typeof UpdateBody>, t = tdb) {
  const { invoice, items, client } = await updateDraft(id, body, t);
  return {
    data: buildDetailPayload(
      serializeInvoice(invoice),
      items.map(serializeLineItem),
      client,
      null
    ),
  };
}

export async function handleFinalize(id: string, orgId: string, t = tdb) {
  const { invoice, items, client } = await finalizeInvoice(id, orgId, t);
  return {
    data: buildDetailPayload(
      serializeInvoice(invoice),
      items.map(serializeLineItem),
      client,
      null,
      invoice.payment_token
    ),
  };
}

export async function handleVoid(id: string, t = tdb) {
  return { data: await voidInvoice(id, t) };
}

export async function handleDelete(id: string, t = tdb) {
  return { data: await deleteDraft(id, t) };
}

const EXAMPLE_DOMAIN_RE = /@(?:[^@]+\.)?example(?:\.com|\.org|\.net)?$/i;

type EnqueueSend = (invoiceId: string) => Promise<unknown>;

const defaultEnqueueSend: EnqueueSend = (invoiceId) =>
  getInvoiceEmailQueue().add('send', { invoiceId }, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10_000 },
  });

export async function handleSend(
  id: string,
  t = tdb,
  enqueue: EnqueueSend = defaultEnqueueSend
) {
  const { invoice, client } = await getInvoiceWithItems(id, t);
  if (invoice.status !== 'open') {
    throw new AppError(409, 'Only open invoices can be sent');
  }

  const isSeeded = invoice.seeded_at != null;
  const isExampleDomain = client.email != null && EXAMPLE_DOMAIN_RE.test(client.email);

  if (isSeeded || isExampleDomain) {
    await t('audit_log').insert({
      source: 'invoice.send',
      org_id: invoice.org_id,
      event_type: 'invoice.email.skipped',
      external_id: invoice.id,
      status: 'skipped',
      payload: {
        reason: isSeeded ? 'seeded' : 'example_domain',
        to: client.email,
      },
    });
    return {
      data: {
        ...serializeInvoice(invoice),
        warnings: ['Email skipped — demo/test invoice'],
      },
    };
  }

  await enqueue(id);
  return { data: serializeInvoice(invoice) };
}

router.get(
  '/',
  tenantScope(async (req, res) => {
    const q = ListQuery.parse(req.query);
    res.json(await handleList(q));
  })
);

router.get(
  '/:id',
  tenantScope(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    res.json(await handleGet(id));
  })
);

router.post(
  '/',
  tenantScope(async (req, res) => {
    const body = CreateBody.parse(req.body);
    const result = await handleCreate(body, req.org!.id);
    res.status(201).json(result);
  })
);

router.patch(
  '/:id',
  tenantScope(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const body = UpdateBody.parse(req.body);
    res.json(await handleUpdate(id, body));
  })
);

router.post(
  '/:id/finalize',
  tenantScope(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    res.json(await handleFinalize(id, req.org!.id));
  })
);

router.post(
  '/:id/send',
  tenantScope(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    res.json(await handleSend(id));
  })
);

router.post(
  '/:id/void',
  tenantScope(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    res.json(await handleVoid(id));
  })
);

router.delete(
  '/:id',
  tenantScope(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    res.json(await handleDelete(id));
  })
);

export default router;
export { CreateBody as CreateInvoiceBody, UpdateBody as UpdateInvoiceBody };
