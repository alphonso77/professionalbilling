import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description:
    'Paste a Clerk session token. In Clerk dashboard → Sessions → copy JWT for testing.',
});

registry.registerComponent('securitySchemes', 'orgIdHeader', {
  type: 'apiKey',
  in: 'header',
  name: 'x-org-id',
  description: 'Development fallback — internal org UUID. Blocked in production.',
});
