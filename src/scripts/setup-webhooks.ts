import { setupStripeWebhooks } from '../services/webhook-setup';
import { logger } from '../utils/logger';

async function main(): Promise<void> {
  try {
    const result = await setupStripeWebhooks();

    if (result.action === 'created') {
      console.log('');
      console.log('Stripe Connect webhook created.');
      console.log(`  id:     ${result.id}`);
      console.log(`  url:    ${result.url}`);
      console.log(`  secret: ${result.secret}`);
      console.log('');
      console.log('  Copy this into STRIPE_WEBHOOK_SECRET and redeploy.');
      console.log('');
    } else {
      console.log('');
      console.log('Stripe Connect webhook already exists — nothing to do.');
      console.log(`  id:  ${result.id}`);
      console.log(`  url: ${result.url}`);
      console.log('');
      console.log(
        '  The signing secret is only visible on creation. If STRIPE_WEBHOOK_SECRET is lost,'
      );
      console.log('  rotate it in the Stripe dashboard and redeploy.');
      console.log('');
    }

    process.exit(0);
  } catch (err) {
    logger.error('Stripe webhook setup failed', { err: (err as Error).message });
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
