import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(8787),
  DATABASE_URL: z.string().url(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  /** Login and sign-up attempts allowed per IP per minute. */
  AUTH_RATE_LIMIT: z.coerce.number().default(10),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = schema.parse(env);
  return {
    port: c.PORT,
    databaseUrl: c.DATABASE_URL,
    s3: { endpoint: c.S3_ENDPOINT, region: c.S3_REGION, bucket: c.S3_BUCKET, accessKey: c.S3_ACCESS_KEY, secretKey: c.S3_SECRET_KEY },
    allowedOrigins: c.APP_ORIGIN.split(',').map(o => o.trim()).filter(Boolean),
    cookieSecure: c.COOKIE_SECURE === 'true',
    authRateLimit: c.AUTH_RATE_LIMIT,
  };
}
