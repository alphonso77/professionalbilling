/**
 * Phase 2C — `/api/ar-settings` surface.
 *
 * Org-level AR automation settings (GET/PATCH), preview (dry run), and
 * run-now (executes AR against the caller's org inside the tenant tx).
 */

import { Router } from 'express';
import { z } from 'zod';

import { registry } from '../openapi/registry';
import { tdb } from '../config/tenant-context';
import { tenantScope } from '../middleware/tenant-scope';
import { AppError } from '../middleware/error-handler';
import {
  ORG_AR_COLUMNS,
  serializeOrgArSettings,
  type OrgArSettings,
} from '../services/ar-settings';
import { executeAR, previewAR } from '../services/ar-executor';

const router = Router();

const ScopeEnum = z.enum(['global', 'per_client']);

const ArSettingsSchema = z
  .object({
    automationEnabled: z.boolean(),
    scope: ScopeEnum,
    runDayOfMonth: z.number().int().min(1).max(28),
    approvalRequired: z.boolean(),
    remindersEnabled: z.boolean(),
    reminderCadenceDays: z.number().int().positive(),
  })
  .openapi('ArSettings');

const UpdateArSettingsBody = z
  .object({
    automationEnabled: z.boolean().optional(),
    scope: ScopeEnum.optional(),
    runDayOfMonth: z.number().int().min(1).max(28).optional(),
    approvalRequired: z.boolean().optional(),
    remindersEnabled: z.boolean().optional(),
    reminderCadenceDays: z.number().int().positive().optional(),
  })
  .openapi('UpdateArSettingsBody');

const PreviewSchema = z
  .object({
    asOfDate: z.string(),
    scheduledRunDate: z.string(),
    wouldCreate: z.array(
      z.object({
        clientId: z.string().uuid(),
        clientName: z.string(),
        timeEntryCount: z.number().int().nonnegative(),
        totalCents: z.number().int().nonnegative(),
      })
    ),
    wouldRemind: z.array(
      z.object({
        invoiceId: z.string().uuid(),
        invoiceNumber: z.string().nullable(),
        clientName: z.string(),
        daysPastIssue: z.number().int().nonnegative(),
        reminderNumber: z.number().int().positive(),
      })
    ),
  })
  .openapi('ArPreview');

const RunNowResponseSchema = z
  .object({
    createdDrafts: z.array(z.string().uuid()),
    finalizedSent: z.array(z.string().uuid()),
    remindersSent: z.array(z.string().uuid()),
    skipped: z.boolean().optional(),
  })
  .openapi('ArRunNowResult');

const SettingsResponse = z.object({ data: ArSettingsSchema });
const PreviewResponse = z.object({ data: PreviewSchema });
const RunNowResponse = z.object({ data: RunNowResponseSchema });

registry.registerPath({
  method: 'get',
  path: '/api/ar-settings',
  tags: ['ar-settings'],
  summary: 'Get the org-level AR automation settings',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  responses: {
    200: { description: 'Settings', content: { 'application/json': { schema: SettingsResponse } } },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/ar-settings',
  tags: ['ar-settings'],
  summary: 'Update the org-level AR automation settings',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { body: { content: { 'application/json': { schema: UpdateArSettingsBody } } } },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: SettingsResponse } } },
    400: { description: 'Validation error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/ar-settings/preview',
  tags: ['ar-settings'],
  summary: 'Dry-run: what would AR do right now?',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  responses: {
    200: { description: 'Preview', content: { 'application/json': { schema: PreviewResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/ar-settings/run-now',
  tags: ['ar-settings'],
  summary: 'Execute AR against the current org right now',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  responses: {
    200: { description: 'Run result', content: { 'application/json': { schema: RunNowResponse } } },
  },
});

export async function handleGet(orgId: string) {
  const row = (await tdb('organizations')
    .where({ id: orgId })
    .select(...ORG_AR_COLUMNS)
    .first()) as OrgArSettings | undefined;
  if (!row) throw new AppError(404, 'Org not found');
  return { data: serializeOrgArSettings(row) };
}

export async function handlePatch(orgId: string, body: z.infer<typeof UpdateArSettingsBody>) {
  const patch: Record<string, unknown> = {};
  if ('automationEnabled' in body) patch.ar_automation_enabled = body.automationEnabled;
  if ('scope' in body) patch.ar_scope = body.scope;
  if ('runDayOfMonth' in body) patch.ar_run_day_of_month = body.runDayOfMonth;
  if ('approvalRequired' in body) patch.ar_approval_required = body.approvalRequired;
  if ('remindersEnabled' in body) patch.ar_reminders_enabled = body.remindersEnabled;
  if ('reminderCadenceDays' in body) patch.ar_reminder_cadence_days = body.reminderCadenceDays;

  if (Object.keys(patch).length) {
    await tdb('organizations').where({ id: orgId }).update(patch);
  }
  return handleGet(orgId);
}

export async function handlePreview(orgId: string) {
  const result = await previewAR(orgId, new Date(), tdb);
  return { data: result };
}

export async function handleRunNow(orgId: string) {
  const result = await executeAR(orgId, new Date(), {
    triggeredBy: 'run-now',
    t: tdb,
  });
  return { data: result };
}

router.get(
  '/',
  tenantScope(async (req, res) => {
    res.json(await handleGet(req.org!.id));
  })
);

router.patch(
  '/',
  tenantScope(async (req, res) => {
    const body = UpdateArSettingsBody.parse(req.body);
    res.json(await handlePatch(req.org!.id, body));
  })
);

router.get(
  '/preview',
  tenantScope(async (req, res) => {
    res.json(await handlePreview(req.org!.id));
  })
);

router.post(
  '/run-now',
  tenantScope(async (req, res) => {
    res.json(await handleRunNow(req.org!.id));
  })
);

export default router;
export { UpdateArSettingsBody };
