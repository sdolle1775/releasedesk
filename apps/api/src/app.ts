import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { z } from 'zod';
import pino from 'pino';
import type { Pool } from 'pg';
import {
  checklistPatchSchema,
  checklistSchema,
  entrySchema,
  idSchema,
  loginSchema,
  releaseSchema,
  renameSchema,
  repositorySchema,
  templateSchema,
} from '@releasedesk/contracts';
import type { Config } from './config.js';
import { AppError, ensure } from './errors.js';
import { GitHubClient, type GitHubSource } from './github.js';
import { createSandbox } from './auth.js';
import { WorkspaceService, type Actor } from './service.js';

declare module 'express-session' {
  interface SessionData {
    auth?: { userId: string; workspaceId: string };
    csrf?: string;
  }
}
// Express exposes request augmentation through its global namespace.
declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor;
    username?: string;
    requestId: string;
  }
}
const log = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: ['req.headers.authorization', 'req.headers.cookie', 'password', 'token'],
});
const same = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createApp(config: Config, pool: Pool, github?: GitHubSource) {
  const app = express();
  const service = new WorkspaceService(pool, github ?? new GitHubClient(pool, config.GITHUB_TOKEN));
  app.locals.service = service;
  app.disable('x-powered-by');
  if (config.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use((req, _res, next) => {
    req.requestId = randomUUID();
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null,
        },
      },
    }),
  );
  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        error: { code: 'API_RATE_LIMIT', message: 'Too many requests. Please retry in a minute.' },
      },
    }),
  );
  app.use(express.json({ limit: '64kb' }));
  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool,
    tableName: 'sessions',
    createTableIfMissing: false,
    pruneSessionInterval: config.NODE_ENV === 'test' ? false : 900,
  });
  app.locals.sessionStore = store;
  app.use(
    session({
      name: 'rd.sid',
      store,
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.use('/api', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const started = Date.now();
    res.on('finish', () =>
      log.info(
        {
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - started,
        },
        'request',
      ),
    );
    if (!req.session.csrf) req.session.csrf = randomBytes(32).toString('hex');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      ensure(
        !origin || origin === config.APP_ORIGIN,
        403,
        'CSRF',
        'This request came from an untrusted origin.',
      );
      ensure(
        same(req.get('x-csrf-token') ?? '', req.session.csrf),
        403,
        'CSRF',
        'Your session token is missing or expired. Refresh and try again.',
      );
    }
    if (req.session.auth) {
      const { userId, workspaceId } = req.session.auth;
      const row = (
        await pool.query(
          'SELECT w.id,w.kind,w.expires_at,u.username FROM workspaces w JOIN users u ON u.id=w.user_id WHERE w.id=$1 AND u.id=$2 AND (w.expires_at IS NULL OR w.expires_at>now())',
          [workspaceId, userId],
        )
      ).rows[0];
      if (row) {
        req.actor = {
          userId,
          workspaceId,
          kind: row.kind,
          ipHash: createHmac('sha256', config.SESSION_SECRET)
            .update(req.ip ?? 'unknown')
            .digest('hex'),
        };
        req.username = row.username;
      } else delete req.session.auth;
    }
    next();
  });
  const sessionInfo = async (req: Request) => {
    const workspace = req.actor
      ? (
          await pool.query('SELECT id,kind,expires_at FROM workspaces WHERE id=$1', [
            req.actor.workspaceId,
          ])
        ).rows[0]
      : null;
    return {
      authenticated: !!req.actor,
      csrfToken: req.session.csrf!,
      username: req.username,
      workspace: workspace
        ? {
            id: workspace.id,
            kind: workspace.kind,
            expiresAt: workspace.expires_at?.toISOString() ?? null,
          }
        : undefined,
      demo: {
        enabled: config.DEMO_ENABLED === 'true',
        username: config.DEMO_USERNAME,
        password: config.DEMO_ENABLED === 'true' ? config.DEMO_PASSWORD : '',
      },
    };
  };
  app.get('/api/auth/session', async (req, res) => res.json(await sessionInfo(req)));
  const loginLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: {
        code: 'LOGIN_RATE_LIMIT',
        message: 'Too many sign-in attempts. Retry in fifteen minutes.',
      },
    },
  });
  app.post('/api/auth/login', loginLimit, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = (await pool.query('SELECT * FROM users WHERE username=$1', [input.username]))
      .rows[0];
    // Do comparable password work even for an unknown username.
    const fallback =
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRmb3JmYWtlYQ$Z5zBL7QOHuRPkEJsvm3/8Fey9l7uZ8aT2ftnFk2EwP0';
    const valid = await argon2
      .verify(user?.password_hash ?? fallback, input.password)
      .catch(() => false);
    ensure(
      user && valid && (user.role !== 'demo' || config.DEMO_ENABLED === 'true'),
      401,
      'INVALID_LOGIN',
      'Username or password is incorrect.',
    );
    let workspaceId: string;
    if (user.role === 'demo') workspaceId = await createSandbox(service, user.id);
    else {
      const workspace = (
        await pool.query("SELECT id FROM workspaces WHERE user_id=$1 AND kind='owner'", [user.id])
      ).rows[0];
      ensure(workspace, 503, 'OWNER_NOT_READY', 'The owner workspace has not been initialized.');
      workspaceId = workspace.id;
    }
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    req.session.auth = { userId: user.id, workspaceId };
    req.session.csrf = randomBytes(32).toString('hex');
    await new Promise<void>((resolve, reject) =>
      req.session.save((error) => (error ? reject(error) : resolve())),
    );
    res.json({ ok: true });
  });
  app.post('/api/auth/logout', async (req, res) => {
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((error) => (error ? reject(error) : resolve())),
    );
    res
      .clearCookie('rd.sid', {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.NODE_ENV === 'production',
      })
      .status(204)
      .end();
  });
  app.use('/api', (req, _res, next) => {
    ensure(req.actor, 401, 'AUTH_REQUIRED', 'Sign in to open your release workspace.');
    next();
  });
  const actor = (req: Request) => req.actor!;
  const id = (value: unknown) => idSchema.parse(value);
  app.post('/api/demo/reset', loginLimit, async (req, res) => {
    const current = actor(req);
    ensure(current.kind === 'demo', 403, 'DEMO_ONLY', 'Only demo sandboxes can be reset.');
    const workspaceId = await createSandbox(service, current.userId, current.workspaceId);
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    req.session.auth = { userId: current.userId, workspaceId };
    req.session.csrf = randomBytes(32).toString('hex');
    await new Promise<void>((resolve, reject) =>
      req.session.save((error) => (error ? reject(error) : resolve())),
    );
    res.json({ ok: true });
  });
  app.post('/api/demo/scenario', async (req, res) =>
    res.status(201).json(await service.createScenario(actor(req))),
  );
  app.get('/api/repositories', async (req, res) =>
    res.json(await service.repositories(actor(req))),
  );
  app.post('/api/repositories', async (req, res) => {
    const input = repositorySchema.parse(req.body);
    res.status(201).json(await service.addRepository(actor(req), input.owner, input.name));
  });
  app.get('/api/repositories/:id', async (req, res) =>
    res.json(await service.repository(actor(req), id(req.params.id))),
  );
  app.patch('/api/repositories/:id', async (req, res) =>
    res.json(
      await service.updateTemplate(
        actor(req),
        id(req.params.id),
        templateSchema.parse(req.body).checklistTemplate,
      ),
    ),
  );
  app.get('/api/repositories/:id/tags', async (req, res) =>
    res.json(
      await service.tags(
        actor(req),
        id(req.params.id),
        z.coerce.number().int().min(1).max(100).default(1).parse(req.query.page),
      ),
    ),
  );
  app.get('/api/releases', async (req, res) => res.json(await service.releases(actor(req))));
  app.get('/api/repositories/:id/releases', async (req, res) =>
    res.json(await service.releases(actor(req), id(req.params.id))),
  );
  app.post('/api/repositories/:id/releases', async (req, res) =>
    res
      .status(201)
      .json(
        await service.createRelease(actor(req), id(req.params.id), releaseSchema.parse(req.body)),
      ),
  );
  app.get('/api/releases/:id', async (req, res) =>
    res.json(await service.detail(actor(req), id(req.params.id))),
  );
  app.patch('/api/releases/:id', async (req, res) =>
    res.json(
      await service.rename(actor(req), id(req.params.id), renameSchema.parse(req.body).title),
    ),
  );
  app.delete('/api/releases/:id', async (req, res) => {
    await service.remove(actor(req), id(req.params.id));
    res.status(204).end();
  });
  app.patch('/api/releases/:id/entries/:entryId', async (req, res) =>
    res.json(
      await service.editEntry(
        actor(req),
        id(req.params.id),
        id(req.params.entryId),
        entrySchema.parse(req.body),
      ),
    ),
  );
  app.post('/api/releases/:id/checklist', async (req, res) =>
    res
      .status(201)
      .json(
        await service.addChecklist(
          actor(req),
          id(req.params.id),
          checklistSchema.parse(req.body).text,
        ),
      ),
  );
  app.patch('/api/releases/:id/checklist/:itemId', async (req, res) =>
    res.json(
      await service.editChecklist(
        actor(req),
        id(req.params.id),
        id(req.params.itemId),
        checklistPatchSchema.parse(req.body),
      ),
    ),
  );
  app.delete('/api/releases/:id/checklist/:itemId', async (req, res) =>
    res.json(
      await service.editChecklist(actor(req), id(req.params.id), id(req.params.itemId), null),
    ),
  );
  app.post('/api/releases/:id/sync', async (req, res) =>
    res.json(await service.sync(actor(req), id(req.params.id))),
  );
  app.post('/api/releases/:id/finalize', async (req, res) =>
    res.json(await service.finalize(actor(req), id(req.params.id))),
  );
  app.get('/api/releases/:id/markdown', async (req, res) =>
    res.json({ markdown: (await service.detail(actor(req), id(req.params.id))).markdown }),
  );
  app.get('/api/releases/:id/sync-runs', async (req, res) =>
    res.json((await service.detail(actor(req), id(req.params.id))).syncRuns),
  );
  app.use('/api', (_req, res) =>
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } }),
  );
  const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  if (existsSync(webRoot)) {
    app.use(express.static(webRoot, { index: false }));
    app.get('/{*path}', (_req, res) =>
      res.sendFile(fileURLToPath(new URL('../../web/dist/index.html', import.meta.url))),
    );
  }
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    res.setHeader('x-request-id', req.requestId ?? '');
    if (error instanceof z.ZodError) {
      res.status(422).json({
        error: {
          code: 'VALIDATION',
          message: 'Check the highlighted input and try again.',
          fields: z.flattenError(error).fieldErrors,
        },
      });
      return;
    }
    if (error instanceof AppError) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.retryAt ? { retryAt: error.retryAt } : {}),
        },
      });
      return;
    }
    if ((error as any)?.type === 'entity.parse.failed') {
      res
        .status(422)
        .json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
      return;
    }
    if ((error as any)?.type === 'entity.too.large') {
      res
        .status(413)
        .json({ error: { code: 'BODY_TOO_LARGE', message: 'The request is too large.' } });
      return;
    }
    log.error(
      { requestId: req.requestId, error: error instanceof Error ? error.message : 'Unknown error' },
      'request failed',
    );
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Your saved work is safe; please retry.',
      },
    });
  });
  return app;
}
