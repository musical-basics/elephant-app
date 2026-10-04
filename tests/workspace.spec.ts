import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { useWorkspace } from '../src/lib/useWorkspace';
import type { AppState } from '../src/lib/model';

declare global {
  interface Window { workspace: ReturnType<typeof useWorkspace> }
}

const ACCOUNT = '10000000-0000-4000-8000-000000000001';
const LOCAL_KEY = 'elephant.workspace.local.v1';
const ACCOUNT_KEY = `elephant.workspace.account.${ACCOUNT}.v1`;
const API_URL = 'https://workspace-tests.supabase.co';
const emptyState = (): AppState => ({
  version: 1, profile: { name: '' }, settings: { showMasterList: true }, projects: [], items: [], queue: [],
});

// Render the real hook without depending on the visual app's controls. All cloud
// traffic is intercepted; these tests never read development credentials.
async function harness(port: number, cloud: boolean): Promise<ViteDevServer> {
  const server = await createServer({
    configFile: false,
    envFile: false,
    root: process.cwd(),
    cacheDir: join(tmpdir(), `elephant-workspace-test-${process.pid}-${port}`),
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(cloud ? API_URL : ''),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(cloud ? 'sb_publishable_test' : ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    },
    server: { port, strictPort: true, host: '127.0.0.1' },
    plugins: [{
      name: 'workspace-test-harness',
      resolveId(id) { if (id === '\0workspace-test-harness') return id; },
      load(id) {
        if (id !== '\0workspace-test-harness') return;
        return `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { useWorkspace } from '/src/lib/useWorkspace.ts';
          function Harness() {
            window.workspace = useWorkspace();
            return React.createElement('output', null, window.workspace.syncStatus);
          }
          createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null, React.createElement(Harness)));
        `;
      },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url !== '/workspace-test') return next();
          res.setHeader('Content-Type', 'text/html');
          res.end('<div id="root"></div><script type="module" src="/@id/__x00__workspace-test-harness"></script>');
        });
      },
    }],
  });
  await server.listen();
  return server;
}

async function open(page: Page, url: string) {
  await page.goto(`${url}/workspace-test`);
  await expect.poll(() => page.evaluate(() => window.workspace?.ready)).toBe(true);
}

async function rename(page: Page, name: string) {
  await page.evaluate(value => window.workspace.update(state => ({ ...state, profile: { name: value } })), name);
}

async function signInFixture(page: Page) {
  const user = { id: ACCOUNT, email: 'elephant@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00.000Z' };
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: ACCOUNT, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`;
  await page.addInitScript(({ user, token }) => {
    localStorage.setItem('sb-workspace-tests-auth-token', JSON.stringify({
      access_token: token, refresh_token: 'test-refresh-token', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, { user, token });
}

type Row = { data: AppState; revision: number };
async function mockCloud(page: Page, initial: Row | null) {
  const remote = {
    row: initial,
    failReads: false,
    writes: [] as { revision: string | null; name: string }[],
    nextWriteGate: null as Promise<void> | null,
  };
  const respond = (route: Route, body: unknown) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(body),
    headers: { 'access-control-allow-origin': '*' },
  });
  await page.route(`${API_URL}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith('/auth/')) return respond(route, {});
    if (request.method() === 'GET') {
      if (remote.failReads) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Test cloud read unavailable' }) });
      return respond(route, remote.row ? [remote.row] : []);
    }
    if (request.method() === 'OPTIONS') return respond(route, {});
    const body = request.postDataJSON() as { data: AppState; revision: number; user_id?: string };
    remote.writes.push({ revision: url.searchParams.get('revision'), name: body.data.profile.name });
    const gate = remote.nextWriteGate;
    remote.nextWriteGate = null;
    if (gate) await gate;
    if ((request.method() === 'PATCH' && url.searchParams.get('revision') !== `eq.${remote.row?.revision}`)
      || (request.method() === 'POST' && remote.row)) return respond(route, null);
    remote.row = { data: body.data, revision: (remote.row?.revision || 0) + 1 };
    return respond(route, { revision: remote.row.revision });
  });
  return remote;
}

test.describe('Workspace persistence', () => {
  let localServer: ViteDevServer;
  let cloudServer: ViteDevServer;
  let localUrl: string;
  let cloudUrl: string;

  test.beforeAll(async ({}, workerInfo) => {
    const port = 5600 + workerInfo.workerIndex * 2;
    [localServer, cloudServer] = await Promise.all([harness(port, false), harness(port + 1, true)]);
    localUrl = `http://127.0.0.1:${port}`;
    cloudUrl = `http://127.0.0.1:${port + 1}`;
  });
  test.afterAll(async () => {
    await Promise.all([localServer?.close(), cloudServer?.close()]);
  });

  test('local changes survive reload without cloud configuration', async ({ page }) => {
    await open(page, localUrl);
    await expect.poll(() => page.evaluate(() => window.workspace.configured)).toBe(false);
    await rename(page, 'My saved workspace');
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.workspace?.state.profile.name)).toBe('My saved workspace');
    expect(await page.evaluate(() => window.workspace.mode)).toBe('local');
  });

  test('corrupt browser data remains untouched and editing pauses', async ({ page }) => {
    await page.addInitScript(key => localStorage.setItem(key, '{broken-json'), LOCAL_KEY);
    await open(page, localUrl);
    expect(await page.evaluate(() => window.workspace.error)).toContain('left untouched');
    await expect(rename(page, 'Must not replace saved data')).rejects.toThrow('Editing is paused');
    expect(await page.evaluate(key => localStorage.getItem(key), LOCAL_KEY)).toBe('{broken-json');
    expect(await page.evaluate(() => window.workspace.state.profile.name)).toBe('');
  });

  test('new accounts start empty and keep local sample data separate', async ({ page }) => {
    await signInFixture(page);
    const remote = await mockCloud(page, null);
    await open(page, cloudUrl);
    expect(await page.evaluate(() => window.workspace.state.items)).toEqual([]);
    expect(await page.evaluate(() => window.workspace.mode)).toBe('cloud');
    expect(remote.writes).toHaveLength(0);
    await rename(page, 'Account name');
    await expect.poll(() => remote.row?.data.profile.name).toBe('Account name');
    await page.evaluate(() => window.workspace.signOut());
    await expect.poll(() => page.evaluate(() => window.workspace.mode)).toBe('local');
    expect(await page.evaluate(() => window.workspace.state.items.length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.workspace.state.profile.name)).not.toBe('Account name');
  });

  test('edits during an in-flight save serialize with the new revision', async ({ page }) => {
    await signInFixture(page);
    const remote = await mockCloud(page, { data: emptyState(), revision: 1 });
    await open(page, cloudUrl);
    let release!: () => void;
    remote.nextWriteGate = new Promise(resolve => { release = resolve; });
    await rename(page, 'First edit');
    await expect.poll(() => remote.writes.length).toBe(1);
    await rename(page, 'Second edit');
    release();
    await expect.poll(() => remote.row?.data.profile.name).toBe('Second edit');
    expect(remote.writes).toEqual([{ revision: 'eq.1', name: 'First edit' }, { revision: 'eq.2', name: 'Second edit' }]);
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).dirty, ACCOUNT_KEY)).toBe(false);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).revision, ACCOUNT_KEY)).toBe(3);
  });

  test('a competing device pauses saves and preserves pending local edits', async ({ page }) => {
    await signInFixture(page);
    const remote = await mockCloud(page, { data: emptyState(), revision: 1 });
    await open(page, cloudUrl);
    remote.row = { data: { ...emptyState(), profile: { name: 'Other device' } }, revision: 2 };
    await rename(page, 'This device');
    await expect.poll(() => page.evaluate(() => window.workspace.error)).toContain('Another device changed');
    expect(remote.row.data.profile.name).toBe('Other device');
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state.profile.name, ACCOUNT_KEY)).toBe('This device');
    await page.evaluate(() => window.workspace.retrySync());
    await expect.poll(() => page.evaluate(() => window.workspace.syncStatus)).toContain('conflicting changes');
    expect(remote.writes).toHaveLength(1);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).dirty, ACCOUNT_KEY)).toBe(true);
  });

  test('a failed initial cloud read keeps edits local until a safe retry', async ({ page }) => {
    await signInFixture(page);
    const remote = await mockCloud(page, null);
    remote.failReads = true;
    await open(page, cloudUrl);
    await rename(page, 'Offline edit');
    await page.waitForTimeout(800);
    expect(remote.writes).toHaveLength(0);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).dirty, ACCOUNT_KEY)).toBe(true);
    remote.failReads = false;
    await page.evaluate(() => window.workspace.retrySync());
    await expect.poll(() => remote.row?.data.profile.name).toBe('Offline edit');
    expect(await page.evaluate(() => window.workspace.error)).toBeNull();
  });

  test('an old account save cannot replace the signed-out workspace', async ({ page }) => {
    await signInFixture(page);
    const remote = await mockCloud(page, { data: emptyState(), revision: 1 });
    await open(page, cloudUrl);
    let release!: () => void;
    remote.nextWriteGate = new Promise(resolve => { release = resolve; });
    await rename(page, 'Account edit in flight');
    await expect.poll(() => remote.writes.length).toBe(1);
    await page.evaluate(() => window.workspace.signOut());
    release();
    await expect.poll(() => page.evaluate(() => window.workspace.mode)).toBe('local');
    await rename(page, 'Local work after sign-out');
    await expect.poll(() => remote.row?.data.profile.name).toBe('Account edit in flight');
    expect(await page.evaluate(() => window.workspace.state.profile.name)).toBe('Local work after sign-out');
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state.profile.name, LOCAL_KEY)).toBe('Local work after sign-out');
  });

  test('magic-link redirects preserve only a recognized design', async ({ page }) => {
    const redirects: string[] = [];
    await page.route(`${API_URL}/auth/v1/otp**`, route => {
      redirects.push(new URL(route.request().url()).searchParams.get('redirect_to') || '');
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await open(page, cloudUrl);
    await page.evaluate(async () => {
      window.location.hash = '/orbit/settings';
      await window.workspace.signIn('test@example.test');
      window.location.hash = '/unknown/settings';
      await window.workspace.signIn('test@example.test');
    });
    expect(redirects).toEqual([`${cloudUrl}/workspace-test?design=orbit`, `${cloudUrl}/workspace-test`]);
  });
});
