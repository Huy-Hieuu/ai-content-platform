import { join } from 'node:path';

const dataDir = process.env.DATA_DIR ?? '.data';
const port = Number(process.env.PORT ?? 3000);

/** All settings come from environment variables with local defaults. No cloud account is needed. */
export const config = {
  port,
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`,
  databasePath: join(dataDir, 'app.db'),
  objectsDir: join(dataDir, 'objects'),
  /** Signs local file URLs. Set a long random value outside local development. */
  signingSecret: process.env.SIGNING_SECRET ?? 'local-development-secret',
};
