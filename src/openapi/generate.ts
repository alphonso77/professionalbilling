import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry';
import { env } from '../config/env';

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Professional Billing API',
      version: '0.1.0',
      description:
        'Time tracking, clients, and invoicing for lawyers, consultants, and accountants.',
    },
    servers: [{ url: env.API_BASE_URL, description: env.NODE_ENV }],
  });
}
