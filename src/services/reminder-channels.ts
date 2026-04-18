/**
 * Phase 2C — pluggable reminder channel registry.
 *
 * v1 ships an email channel backed by the existing invoice-email queue.
 * Adding Slack/SMS is a matter of implementing ReminderChannel and
 * registering it in `channels` below.
 */

import { getInvoiceEmailQueue } from '../config/queues';

export interface ReminderPayload {
  invoiceId: string;
  orgId: string;
  clientId: string;
  reminderNumber: number;
}

export interface ReminderChannel {
  readonly name: string;
  send(payload: ReminderPayload): Promise<void>;
}

export const emailReminderChannel: ReminderChannel = {
  name: 'email',
  async send(payload) {
    await getInvoiceEmailQueue().add(
      'reminder',
      {
        invoiceId: payload.invoiceId,
        reminder: true,
        reminderNumber: payload.reminderNumber,
      },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
      }
    );
  },
};

const channels: Record<string, ReminderChannel> = {
  email: emailReminderChannel,
};

export function sendReminder(name: string, payload: ReminderPayload): Promise<void> {
  const channel = channels[name];
  if (!channel) throw new Error(`Unknown reminder channel: ${name}`);
  return channel.send(payload);
}

export function registerChannel(channel: ReminderChannel): void {
  channels[channel.name] = channel;
}
