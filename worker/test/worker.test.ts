import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/env';
import wranglerToml from '../../wrangler.toml?raw';

const ENV: Env = { ALLOWED_ORIGINS: 'https://kiosk.test,http://localhost:5173', HOLDED_API_BASE: 'https://holded.test' };
const ID = 'a'.repeat(24);
const HOUR = 3_600_000;
const SINCE = Date.parse('2026-01-10T00:00:00Z');

type Upstream = (url: URL, init: RequestInit) => Response | Promise<Response>;

let upstreamCalls: { url: URL; init: RequestInit }[];

function stubUpstream(handler: Upstream) {
	upstreamCalls = [];
	vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
		const url = new URL(String(input));
		upstreamCalls.push({ url, init });
		return handler(url, init);
	});
}

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const page = (items: unknown[], cursor: string | null = null) => jsonResponse({ items, has_more: cursor !== null, cursor });

const employee = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
	id,
	full_name: name,
	terminated: null,
	current_contract: { id: 'c' },
	iban: 'ES9121000418450200051332',
	social_security_number: '28/12345678/90',
	...extra,
});

const entry = (employeeId: string, startMs: number, endMs: number | null, status = endMs === null ? 'running' : 'done') => ({
	employee_id: employeeId,
	start_at: new Date(startMs).toISOString(),
	end_at: endMs === null ? null : new Date(endMs).toISOString(),
	status,
});

const call = (path: string, init: RequestInit & { key?: string | null; env?: Env } = {}) => {
	const { key = 'key-1', env = ENV, ...rest } = init;
	const headers = new Headers(rest.headers);
	if (key) headers.set('X-Holded-API-Key', key);
	return worker.fetch(new Request(`https://worker.test${path}`, { ...rest, headers }), env);
};

beforeEach(() => stubUpstream(() => page([])));
afterEach(() => vi.unstubAllGlobals());

describe('GET /api/employees', () => {
	it('follows the cursor, returns only active employees and only id and name', async () => {
		stubUpstream((url) =>
			url.searchParams.get('cursor') === 'c2'
				? page([employee('2'.repeat(24), 'Beta'), employee('3'.repeat(24), 'Gone', { terminated: 1700000000 })])
				: page([employee('1'.repeat(24), 'Alfa'), employee('4'.repeat(24), 'Nocontract', { current_contract: null })], 'c2')
		);

		const response = await call('/api/employees');
		const text = await response.text();

		expect(response.status).toBe(200);
		expect(JSON.parse(text)).toEqual([
			{ id: '1'.repeat(24), name: 'Alfa' },
			{ id: '2'.repeat(24), name: 'Beta' },
		]);
		expect(text).not.toContain('ES9121000418450200051332');
		expect(text).not.toContain('social_security_number');
		expect(upstreamCalls).toHaveLength(2);
	});

	it('makes one upstream call when the first page is the last', async () => {
		stubUpstream(() => page([employee('1'.repeat(24), 'Alfa')]));

		await call('/api/employees');

		expect(upstreamCalls).toHaveLength(1);
	});

	it('stops following cursors after 25 pages', async () => {
		let n = 0;
		stubUpstream(() => page([employee('1'.repeat(24), 'Alfa')], `p${++n}`));

		const response = await call('/api/employees');

		expect(response.status).toBe(200);
		expect(upstreamCalls).toHaveLength(25);
	});

	it('authenticates upstream with the caller key as a Bearer token', async () => {
		await call('/api/employees', { key: 'key-abc' });
		expect(new Headers(upstreamCalls[0].init.headers).get('authorization')).toBe('Bearer key-abc');
	});

	it('answers 502 when upstream returns an unknown shape', async () => {
		stubUpstream(() => jsonResponse({ unexpected: true }));
		expect((await call('/api/employees')).status).toBe(502);
	});
});

describe('GET /api/account', () => {
	const account = (extra: Record<string, unknown> = {}) => ({
		id: 'acc1',
		name: 'Razon Social SL',
		trade_name: '',
		website: 'https://acme.test',
		tax_id: 'B12345678',
		logo: '/box/account/abc?p=abc',
		...extra,
	});

	const info = async (body: Record<string, unknown>) => {
		stubUpstream(() => jsonResponse(body));
		return call('/api/account');
	};

	it('prefers trade_name and falls back to name when it is empty', async () => {
		expect(await (await info(account({ trade_name: 'Acme' }))).json()).toMatchObject({ name: 'Acme' });
		expect(await (await info(account({ trade_name: '' }))).json()).toMatchObject({ name: 'Razon Social SL' });
		expect(await (await info(account({ trade_name: null }))).json()).toMatchObject({ name: 'Razon Social SL' });
	});

	it.each([
		['/box/account/abc?p=abc', 'https://app.holded.com/box/account/abc?p=abc'],
		['https://cdn.test/logo.png', 'https://cdn.test/logo.png'],
		['http://cdn.test/logo.png', null],
		['data:image/png;base64,AAAA', null],
		['javascript:alert(1)', null],
		['', null],
		[undefined, null],
	])('maps logo %s to %s', async (logo, expected) => {
		const response = await info(account({ logo }));

		expect(await response.json()).toMatchObject({ logoUrl: expected });
	});

	it('returns only name and logoUrl and authenticates with the caller key', async () => {
		const response = await info(account({ trade_name: 'Acme' }));

		expect(Object.keys((await response.json()) as object).sort()).toEqual(['logoUrl', 'name']);
		expect(upstreamCalls).toHaveLength(1);
		expect(upstreamCalls[0].url.pathname).toBe('/api/v2/account');
		expect(new Headers(upstreamCalls[0].init.headers).get('authorization')).toBe('Bearer key-1');
	});

	it('passes a 403 for a missing scope through with its detail', async () => {
		stubUpstream(() => jsonResponse({ status: 403, detail: 'Missing scope account:info.read' }, 403));

		const response = await call('/api/account');

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ detail: 'Missing scope account:info.read' });
	});

	it('answers 502 when upstream returns an unknown shape', async () => {
		expect((await info({ trade_name: 'Acme' })).status).toBe(502);
	});
});

describe('GET /api/times', () => {
	it('makes one upstream call when the first page already reaches before since', async () => {
		stubUpstream(() => page([entry(ID, SINCE + 2 * HOUR, null), entry(ID, SINCE - HOUR, SINCE - HOUR / 2)], 'next'));

		const response = await call(`/api/times?since=${SINCE}`);

		expect(response.status).toBe(200);
		expect(upstreamCalls).toHaveLength(1);
	});

	it('makes one upstream call when the first page is empty, even if it carries a cursor', async () => {
		stubUpstream(() => page([], 'next'));

		const response = await call(`/api/times?since=${SINCE}`);

		expect(await response.json()).toEqual([]);
		expect(upstreamCalls).toHaveLength(1);
	});

	it('keeps paging while the oldest entry on the page is not before since', async () => {
		stubUpstream((url) =>
			url.searchParams.get('cursor') === 'p2'
				? page([entry(ID, SINCE - HOUR, SINCE - HOUR / 2)])
				: page([entry(ID, SINCE + 3 * HOUR, SINCE + 4 * HOUR), entry(ID, SINCE + HOUR, SINCE + 2 * HOUR)], 'p2')
		);

		const body = await (await call(`/api/times?since=${SINCE}`)).json();

		expect(upstreamCalls).toHaveLength(2);
		expect(body).toHaveLength(2);
	});

	it('keeps paging when the page is not sorted newest first, even if an entry is before since', async () => {
		stubUpstream((url) =>
			url.searchParams.get('cursor') === 'p2'
				? page([entry(ID, SINCE + 5 * HOUR, SINCE + 6 * HOUR)])
				: page([entry(ID, SINCE - HOUR, SINCE - HOUR / 2), entry(ID, SINCE + 3 * HOUR, SINCE + 4 * HOUR)], 'p2')
		);

		const body = await (await call(`/api/times?since=${SINCE}`)).json();

		expect(upstreamCalls).toHaveLength(2);
		expect(body).toHaveLength(2);
	});

	it('stops at the 5 page cap', async () => {
		let n = 0;
		stubUpstream(() => page([entry(ID, SINCE + HOUR, SINCE + 2 * HOUR)], `p${++n}`));

		const body = await (await call(`/api/times?since=${SINCE}`)).json();

		expect(upstreamCalls).toHaveLength(5);
		expect(body).toHaveLength(5);
	});

	it('returns running entries that started before since and drops finished older ones', async () => {
		stubUpstream(() => page([entry(ID, SINCE + HOUR, null), entry(ID, SINCE - 5 * HOUR, null), entry(ID, SINCE - 6 * HOUR, SINCE - 5 * HOUR)]));

		const body = await (await call(`/api/times?since=${SINCE}`)).json();

		expect(body).toEqual([
			{ employeeId: ID, start: SINCE + HOUR, end: null, paused: false },
			{ employeeId: ID, start: SINCE - 5 * HOUR, end: null, paused: false },
		]);
	});

	it('converts ISO instants to epoch ms', async () => {
		stubUpstream(() => page([entry(ID, SINCE + HOUR, SINCE + 2 * HOUR)]));

		const body = await (await call(`/api/times?since=${SINCE}`)).json();

		expect(body).toEqual([{ employeeId: ID, start: SINCE + HOUR, end: SINCE + 2 * HOUR, paused: false }]);
	});

	it.each(['paused', 'Paused', 'PAUSED'])('reports a running entry with status %s as paused', async (status) => {
		stubUpstream(() => page([entry(ID, SINCE + HOUR, null, status)]));

		const body = await (await call(`/api/times?since=${SINCE}`)).json();

		expect(body).toEqual([{ employeeId: ID, start: SINCE + HOUR, end: null, paused: true }]);
	});

	it('never reports a finished entry as paused', async () => {
		stubUpstream(() => page([entry(ID, SINCE + HOUR, SINCE + 2 * HOUR, 'paused')]));

		const body = await (await call(`/api/times?since=${SINCE}`)).json();

		expect(body).toEqual([{ employeeId: ID, start: SINCE + HOUR, end: SINCE + 2 * HOUR, paused: false }]);
	});

	it.each(['', '?since=', '?since=abc', '?since=Infinity'])('answers 400 for a bad since (%s)', async (query) => {
		const response = await call(`/api/times${query}`);

		expect(response.status).toBe(400);
		expect(upstreamCalls).toHaveLength(0);
	});
});

describe.each(['clock-in', 'clock-out', 'pause', 'unpause'])('POST /api/employees/:id/%s', (action) => {
	const post = (id: string) => call(`/api/employees/${id}/${action}`, { method: 'POST' });

	it('succeeds with { ok: true } and one POST upstream', async () => {
		stubUpstream(() => jsonResponse({ id: 'x' }, 201));

		const response = await post(ID);

		expect(await response.json()).toEqual({ ok: true });
		expect(upstreamCalls).toHaveLength(1);
		expect(upstreamCalls[0].init.method).toBe('POST');
		expect(upstreamCalls[0].url.pathname).toBe(`/api/v2/employees/${ID}/${action}`);
	});

	it.each(['abc', 'A'.repeat(24), `${ID}0`, '..%2Fx'])('answers 400 without calling Holded for id %s', async (id) => {
		const response = await post(id);

		expect(response.status).toBe(400);
		expect(upstreamCalls).toHaveLength(0);
	});

	it('keeps an upstream 404 and its detail', async () => {
		stubUpstream(() => jsonResponse({ title: 'Not Found', status: 404, detail: 'No running time entry' }, 404));

		const response = await post(ID);

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ detail: 'No running time entry' });
	});

	it('keeps an upstream 429 and passes Retry-After through', async () => {
		stubUpstream(() => jsonResponse({ status: 429, detail: 'slow down' }, 429, { 'retry-after': '17' }));

		const response = await post(ID);

		expect(response.status).toBe(429);
		expect(response.headers.get('Retry-After')).toBe('17');
	});

	it('passes the monthly quota headers of a Holded 429 through and exposes them to CORS', async () => {
		stubUpstream(() =>
			jsonResponse({ status: 429, detail: 'quota' }, 429, {
				'retry-after': '86400',
				'x-ratelimit-window': 'month',
				'x-ratelimit-remaining': '0',
				'x-ratelimit-reset': '1790000000',
				'x-request-id': 'internal',
			})
		);

		const response = await call(`/api/times?since=${SINCE}`, { headers: { Origin: 'https://kiosk.test' } });

		expect(response.status).toBe(429);
		expect(response.headers.get('X-RateLimit-Window')).toBe('month');
		expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
		expect(response.headers.get('X-RateLimit-Reset')).toBe('1790000000');
		expect(response.headers.get('Retry-After')).toBe('86400');
		expect(response.headers.get('X-Request-Id')).toBeNull();
		const exposed = (response.headers.get('Access-Control-Expose-Headers') ?? '').split(',').map((name) => name.trim().toLowerCase());
		expect(exposed).toEqual(expect.arrayContaining(['retry-after', 'x-ratelimit-window', 'x-ratelimit-remaining', 'x-ratelimit-reset']));
	});

	it('passes the minute window through on a clock action 429', async () => {
		stubUpstream(() => jsonResponse({ status: 429 }, 429, { 'retry-after': '12', 'x-ratelimit-window': 'minute' }));

		const response = await post(ID);

		expect(response.headers.get('X-RateLimit-Window')).toBe('minute');
		expect(response.headers.get('Retry-After')).toBe('12');
	});

	it('maps an upstream 500 to 502', async () => {
		stubUpstream(() => jsonResponse({ detail: 'boom' }, 500));

		expect((await post(ID)).status).toBe(502);
	});

	it('maps a network failure to 502', async () => {
		stubUpstream(() => {
			throw new TypeError('network down');
		});

		expect((await post(ID)).status).toBe(502);
	});
});

describe('auth, routing and CORS', () => {
	it('answers 401 without a key and never calls Holded', async () => {
		const response = await call('/api/employees', { key: null });

		expect(response.status).toBe(401);
		expect(await response.json()).toHaveProperty('error');
		expect(upstreamCalls).toHaveLength(0);
	});

	it('answers 404 for an unknown route', async () => {
		expect((await call('/api/nope')).status).toBe(404);
	});

	it('echoes an allowed origin with Vary: Origin', async () => {
		const response = await call('/api/employees', { headers: { Origin: 'https://kiosk.test' } });

		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://kiosk.test');
		expect(response.headers.get('Vary')).toBe('Origin');
	});

	it('does not echo a disallowed origin', async () => {
		const response = await call('/api/employees', { headers: { Origin: 'https://evil.test' } });

		expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	it('sets CORS headers on error responses too', async () => {
		const response = await call('/api/employees', { key: null, headers: { Origin: 'https://kiosk.test' } });

		expect(response.status).toBe(401);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://kiosk.test');
	});

	it('answers an OPTIONS preflight without a key', async () => {
		const response = await call('/api/employees/' + ID + '/clock-in', {
			method: 'OPTIONS',
			key: null,
			headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
		});

		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
		expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
		expect(response.headers.get('Access-Control-Allow-Headers')).toContain('x-holded-api-key');
		expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
		expect(upstreamCalls).toHaveLength(0);
	});
});

describe('CORS without ALLOWED_ORIGINS', () => {
	it.each([undefined, '', ' , '])('grants no cross-origin access when it is %j', async (allowed) => {
		const env: Env = { HOLDED_API_BASE: 'https://holded.test', ALLOWED_ORIGINS: allowed };
		const headers = { Origin: 'https://kiosk.test' };

		const response = await call('/api/employees', { headers, env });
		const preflight = await call('/api/employees', { method: 'OPTIONS', key: null, headers, env });

		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
		expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});
});

describe('response headers', () => {
	it.each([
		['success', () => call('/api/employees')],
		['auth error', () => call('/api/employees', { key: null })],
		['not found', () => call('/api/nope')],
		['preflight', () => call('/api/employees', { method: 'OPTIONS', key: null })],
	])('are no-store and nosniff on a %s response', async (_name, request) => {
		const response = await request();

		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
	});
});

describe('rate limiting', () => {
	const limiter = (allow: (key: string) => boolean) => {
		const keys: string[] = [];
		const binding: RateLimit = {
			limit: async ({ key }) => {
				keys.push(key);
				return { success: allow(key) };
			},
		};
		return { keys, env: { ...ENV, RATE_LIMITER: binding } satisfies Env };
	};

	it('lets requests through under the limit and keys them by client IP', async () => {
		const { keys, env } = limiter(() => true);

		const response = await call('/api/employees', { env, headers: { 'CF-Connecting-IP': '203.0.113.7' } });

		expect(response.status).toBe(200);
		expect(keys).toEqual(['203.0.113.7']);
	});

	it('answers 429 with Retry-After, CORS headers and no upstream call when over the limit', async () => {
		const { env } = limiter((key) => key !== '203.0.113.7');
		const headers = { 'CF-Connecting-IP': '203.0.113.7', Origin: 'https://kiosk.test' };

		const response = await call('/api/employees', { env, headers });

		expect(response.status).toBe(429);
		expect(response.headers.get('Retry-After')).toBe('60');
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://kiosk.test');
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toHaveProperty('error');
		expect(upstreamCalls).toHaveLength(0);

		const other = await call('/api/employees', { env, headers: { 'CF-Connecting-IP': '203.0.113.8' } });
		expect(other.status).toBe(200);
	});

	it('limits before checking the key', async () => {
		const { env } = limiter(() => false);

		expect((await call('/api/employees', { env, key: null })).status).toBe(429);
	});

	it('lets the request through when the limiter throws', async () => {
		const env: Env = {
			...ENV,
			RATE_LIMITER: {
				limit: async () => {
					throw new Error('binding unavailable');
				},
			},
		};

		expect((await call('/api/employees', { env })).status).toBe(200);
	});

	it('answers preflight 204 even when the limiter denies everything', async () => {
		const { keys, env } = limiter(() => false);

		const response = await call('/api/employees', { env, method: 'OPTIONS', headers: { Origin: 'https://kiosk.test' } });

		expect(response.status).toBe(204);
		expect(keys).toEqual([]);
	});

	it('does not limit when the binding is absent', async () => {
		expect(ENV.RATE_LIMITER).toBeUndefined();
		expect((await call('/api/employees')).status).toBe(200);
	});
});

describe('sealed tokens', () => {
	const PLAIN = 'key-secret-plain';

	class MemoryKv {
		reads = 0;
		private items = new Map<string, string>();
		constructor(private latency = 0) {}
		async get(name: string) {
			this.reads++;
			await new Promise((resolve) => setTimeout(resolve, this.latency));
			return this.items.get(name) ?? null;
		}
		async put(name: string, value: string) {
			await new Promise((resolve) => setTimeout(resolve, this.latency));
			this.items.set(name, value);
		}
		asBinding() {
			return this as unknown as KVNamespace;
		}
	}

	// Models KV's eventual consistency: a location reads its own writes at once and other locations' writes only after propagate().
	class EventualKv {
		private committed = new Map<string, string>();
		private local = new Map<string, Map<string, string>>();
		constructor(private latency = 0) {}
		at(location: string): KVNamespace {
			const own = new Map<string, string>();
			this.local.set(location, own);
			const latency = this.latency;
			const committed = this.committed;
			return {
				async get(name: string) {
					await new Promise((resolve) => setTimeout(resolve, latency));
					return own.get(name) ?? committed.get(name) ?? null;
				},
				async put(name: string, value: string) {
					await new Promise((resolve) => setTimeout(resolve, latency));
					own.set(name, value);
				},
			} as unknown as KVNamespace;
		}
		propagate() {
			for (const own of this.local.values()) for (const [name, value] of own) this.committed.set(name, value);
		}
		has(name: string) {
			return this.committed.has(name);
		}
	}

	const sealedEnv = (kv: MemoryKv | KVNamespace = new MemoryKv()): Env => ({ ...ENV, KIOSK_KEYS: kv instanceof MemoryKv ? kv.asBinding() : kv });

	const seal = async (env: Env, key = PLAIN) => {
		const response = await call('/api/seal', { method: 'POST', key, env });
		return { response, body: (await response.json()) as { token: string; employees: unknown[] } };
	};

	const authorizations = () => upstreamCalls.map((c) => new Headers(c.init.headers).get('authorization'));

	it('seals a key with one Holded employees call and returns the employees', async () => {
		stubUpstream(() => page([employee('1'.repeat(24), 'Alfa')]));

		const { response, body } = await seal(sealedEnv());

		expect(response.status).toBe(200);
		expect(body.token).toMatch(/^sealed\.v1\.[\w-]{11}\.[\w-]+\.[\w-]+$/);
		expect(body.employees).toEqual([{ id: '1'.repeat(24), name: 'Alfa' }]);
		expect(upstreamCalls.map((c) => c.url.pathname)).toEqual(['/api/v2/employees']);
		expect(authorizations()).toEqual([`Bearer ${PLAIN}`]);
	});

	it('never puts the plain key in the seal response', async () => {
		const { response, body } = await seal(sealedEnv());

		expect(JSON.stringify(body)).not.toContain(PLAIN);
		expect(JSON.stringify(body)).not.toContain(btoa(PLAIN).replaceAll('=', ''));
		expect(response.headers.get('X-Holded-API-Key')).toBeNull();
	});

	it('produces a different token every time for the same key', async () => {
		const env = sealedEnv();

		expect((await seal(env)).body.token).not.toBe((await seal(env)).body.token);
	});

	it('does not seal when Holded rejects the key', async () => {
		stubUpstream(() => jsonResponse({ detail: 'Unauthorized' }, 401));

		const { response, body } = await seal(sealedEnv());

		expect(response.status).toBe(401);
		expect(body).not.toHaveProperty('token');
	});

	it('refuses to seal an already sealed token', async () => {
		const env = sealedEnv();
		const { body } = await seal(env);
		upstreamCalls.length = 0;

		const response = await call('/api/seal', { method: 'POST', key: body.token, env });

		expect(response.status).toBe(400);
		expect(upstreamCalls).toHaveLength(0);
	});

	it('answers 503 on seal when the Worker has no KV binding, and still serves plain keys', async () => {
		expect((await seal(ENV)).response.status).toBe(503);
		expect((await call('/api/employees', { key: PLAIN })).status).toBe(200);
	});

	it('passes the CORS preflight for POST /api/seal', async () => {
		const response = await call('/api/seal', {
			method: 'OPTIONS',
			key: null,
			headers: { Origin: 'https://kiosk.test', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-holded-api-key' },
		});

		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://kiosk.test');
		expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
		expect(response.headers.get('Access-Control-Allow-Headers')).toContain('x-holded-api-key');
	});

	describe('using a sealed token', () => {
		let env: Env;
		let token: string;

		beforeEach(async () => {
			env = sealedEnv();
			token = (await seal(env)).body.token;
			upstreamCalls.length = 0;
			stubUpstream((url) => (url.pathname === '/api/v2/account' ? jsonResponse({ name: 'Acme', logo: null }) : page([])));
		});

		it.each([
			['/api/account', 'GET'],
			['/api/employees', 'GET'],
			[`/api/times?since=${SINCE}`, 'GET'],
			[`/api/employees/${ID}/clock-in`, 'POST'],
			[`/api/employees/${ID}/clock-out`, 'POST'],
			[`/api/employees/${ID}/pause`, 'POST'],
			[`/api/employees/${ID}/unpause`, 'POST'],
		])('%s authenticates upstream with the plain key', async (path, method) => {
			const response = await call(path, { method, key: token, env });

			expect(response.status).toBe(200);
			expect(upstreamCalls).toHaveLength(1);
			expect(authorizations()).toEqual([`Bearer ${PLAIN}`]);
		});

		it('still unseals a token sealed with the frozen additional data "holded-kiosk/v1"', async () => {
			const kv = new MemoryKv();
			const sealingEnv = sealedEnv(kv);
			const [prefix, version, kid] = (await seal(sealingEnv)).body.token.split('.');
			const raw = (await kv.get(`sealing-key:${kid}`))!;
			const bytes = (text: string) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
			const b64url = (data: Uint8Array) => btoa(String.fromCharCode(...data)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
			const aesKey = await crypto.subtle.importKey('raw', bytes(raw), 'AES-GCM', false, ['encrypt']);
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const additionalData = new TextEncoder().encode('holded-kiosk/v1');
			const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, aesKey, new TextEncoder().encode(PLAIN));
			const legacy = `${prefix}.${version}.${kid}.${b64url(iv)}.${b64url(new Uint8Array(encrypted))}`;
			upstreamCalls.length = 0;

			const response = await call('/api/employees', { key: legacy, env: sealingEnv });

			expect(response.status).toBe(200);
			expect(authorizations()).toEqual([`Bearer ${PLAIN}`]);
		});

		it('is rejected with 401 and no Holded call when the key stored under its kid is another one', async () => {
			const other = new MemoryKv();
			await other.put(`sealing-key:${token.split('.')[2]}`, 'A'.repeat(43));

			const response = await call('/api/employees', { key: token, env: sealedEnv(other) });

			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ error: 'Sealed token is not valid for this kiosk' });
			expect(upstreamCalls).toHaveLength(0);
		});

		it.each([
			['ciphertext', (parts: string[]) => [...parts.slice(0, 4), flip(parts[4])]],
			['iv', (parts: string[]) => [...parts.slice(0, 3), flip(parts[3]), parts[4]]],
			['version', (parts: string[]) => ['sealed', 'v2', ...parts.slice(2)]],
			['shape', () => ['sealed', 'v1', 'AAAAAAAAAAA', 'AAAA']],
			['kid shape', (parts: string[]) => [...parts.slice(0, 2), '../x', ...parts.slice(3)]],
			['encoding', (parts: string[]) => [...parts.slice(0, 4), '***']],
		])('is rejected with 401 and no Holded call when the %s is tampered', async (_name, tamper) => {
			const tampered = tamper(token.split('.')).join('.');

			const response = await call('/api/employees', { key: tampered, env });

			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ error: 'Sealed token is not valid for this kiosk' });
			expect(upstreamCalls).toHaveLength(0);
		});

		it('is rejected when the ciphertext was made without the purpose binding', async () => {
			const kv = new MemoryKv();
			const bound = sealedEnv(kv);
			await seal(bound);
			const kid = (await kv.get('sealing-key-current')) as string;
			const raw = (await kv.get(`sealing-key:${kid}`)) as string;
			const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(raw.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0)), 'AES-GCM', false, ['encrypt']);
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(PLAIN));
			const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

			const response = await call('/api/employees', { key: `sealed.v1.${kid}.${b64(iv)}.${b64(new Uint8Array(encrypted))}`, env: bound });

			expect(response.status).toBe(401);
		});

		it('answers 503, not 401, for a kid that is not stored', async () => {
			const unknown = ['sealed', 'v1', 'AAAAAAAAAAA', ...token.split('.').slice(3)].join('.');

			const response = await call('/api/employees', { key: unknown, env });

			expect(response.status).toBe(503);
			expect(await response.json()).toEqual({ error: 'Sealing key is not available yet, try again in a minute' });
			expect(upstreamCalls).toHaveLength(0);
		});

		it('answers 503 when the Worker has no KV binding', async () => {
			const response = await call('/api/employees', { key: token, env: ENV });

			expect(response.status).toBe(503);
			expect(upstreamCalls).toHaveLength(0);
		});

		it('still accepts a plain key', async () => {
			const response = await call('/api/employees', { key: 'key-plain', env });

			expect(response.status).toBe(200);
			expect(authorizations()).toEqual(['Bearer key-plain']);
		});
	});

	it('reads KV only on first use, not on every request', async () => {
		const kv = new MemoryKv();
		const env = sealedEnv(kv);

		const { body } = await seal(env);
		const readsAfterFirstSeal = kv.reads;
		await call('/api/employees', { key: body.token, env });
		await seal(env);

		expect(readsAfterFirstSeal).toBe(1);
		expect(kv.reads).toBe(readsAfterFirstSeal);
	});

	describe('with eventually consistent KV', () => {
		const sealAt = async (env: Env) => (await seal(env)).body.token;
		const unsealAt = (env: Env, token: string) => call('/api/employees', { key: token, env });

		it('opens both tokens from both locations when two locations seal for the first time at once', async () => {
			const kv = new EventualKv(5);
			const a = sealedEnv(kv.at('a'));
			const b = sealedEnv(kv.at('b'));

			const [tokenA, tokenB] = await Promise.all([sealAt(a), sealAt(b)]);
			kv.propagate();

			expect(tokenA.split('.')[2]).not.toBe(tokenB.split('.')[2]);
			for (const token of [tokenA, tokenB]) {
				for (const env of [a, b]) expect((await unsealAt(env, token)).status).toBe(200);
			}
		});

		it('answers 503 for a kid another location wrote, does not cache the miss, and succeeds after propagation', async () => {
			const kv = new EventualKv();
			const a = sealedEnv(kv.at('a'));
			const b = sealedEnv(kv.at('b'));
			const token = await sealAt(a);

			const early = await unsealAt(b, token);
			expect(early.status).toBe(503);
			expect(await early.json()).toEqual({ error: 'Sealing key is not available yet, try again in a minute' });

			kv.propagate();

			expect((await unsealAt(b, token)).status).toBe(200);
		});
	});
});

function flip(part: string): string {
	return (part[0] === 'A' ? 'B' : 'A') + part.slice(1);
}

describe('kiosk password', () => {
	const PASSWORD = 'correct horse battery staple';
	const basic = (user: string, password: string) => `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${password}`)))}`;
	const GOOD = basic('kiosk', PASSWORD);

	let assetRequests: string[];
	const ASSETS = {
		fetch: async (input: Request) => {
			assetRequests.push(new URL(input.url).pathname);
			return new Response('<html>kiosk</html>', { headers: { 'content-type': 'text/html' } });
		},
	} as unknown as Fetcher;
	const on: Env = { ...ENV, KIOSK_PASSWORD: PASSWORD, ASSETS };

	beforeEach(() => {
		assetRequests = [];
	});

	const PATHS: [string, string, string | null][] = [
		['the page', '/', null],
		['an asset', '/assets/index-abc.js', null],
		['an API route', '/api/employees', 'key-1'],
		['the seal route', '/api/seal', 'key-1'],
	];
	const method = (path: string) => (path === '/api/seal' ? 'POST' : 'GET');
	const get = (path: string, env: Env, authorization?: string, extra: Record<string, string> = {}) =>
		call(path, {
			env,
			method: method(path),
			key: path.startsWith('/api') ? 'key-1' : null,
			headers: { ...(authorization ? { Authorization: authorization } : {}), ...extra },
		});

	describe('when KIOSK_PASSWORD is not set', () => {
		it.each([undefined, ''])('serves assets and the API as before (password %j)', async (password) => {
			const env: Env = { ...ENV, KIOSK_PASSWORD: password, ASSETS };

			const page = await get('/', env);
			const api = await get('/api/employees', env);

			expect(page.status).toBe(200);
			expect(await page.text()).toBe('<html>kiosk</html>');
			expect(api.status).toBe(200);
			expect(assetRequests).toEqual(['/']);
		});

		it('does not rate limit asset requests', async () => {
			const limit = vi.fn(async () => ({ success: false }));

			const page = await get('/', { ...ENV, ASSETS, RATE_LIMITER: { limit } });

			expect(page.status).toBe(200);
			expect(limit).not.toHaveBeenCalled();
		});

		it('treats a whitespace-only password as auth off', async () => {
			const response = await get('/', { ...ENV, KIOSK_PASSWORD: ' \n\t ', ASSETS });
			expect(response.status).toBe(200);
			expect(assetRequests).toEqual(['/']);
		});

		it('accepts an empty password credential because auth is off', async () => {
			const response = await get('/', { ...ENV, KIOSK_PASSWORD: '', ASSETS }, basic('kiosk', ''));
			expect(response.status).toBe(200);
		});
	});

	describe('when KIOSK_PASSWORD is set', () => {
		it.each(PATHS)('answers 401 with the challenge and no body for %s, with zero upstream or asset calls', async (_name, path) => {
			const response = await get(path, on);

			expect(response.status).toBe(401);
			expect(response.headers.get('WWW-Authenticate')).toBe('Basic realm="Kiosk for Holded", charset="UTF-8"');
			expect(await response.text()).toBe('');
			expect(upstreamCalls).toHaveLength(0);
			expect(assetRequests).toHaveLength(0);
		});

		it.each(PATHS)('lets correct credentials through for %s', async (_name, path) => {
			stubUpstream((url) => (url.pathname.endsWith('/employees') ? page([employee('1'.repeat(24), 'Alfa')]) : page([])));

			const response = await get(path, on, GOOD);

			expect(response.status).toBe(path === '/api/seal' ? 503 : 200);
			if (path.startsWith('/api')) expect(response.headers.get('Cache-Control')).toBe('no-store');
			else expect(assetRequests).toEqual([path]);
		});

		it('does not reveal whether sealing is configured before authenticating', async () => {
			const response = await get('/api/seal', { ...on, KIOSK_KEYS: undefined });
			expect(response.status).toBe(401);
			expect(await response.text()).toBe('');
		});

		it('keeps CORS headers on an API 401 so a cross-origin kiosk can show a clear message', async () => {
			const response = await get('/api/employees', on, undefined, { Origin: 'https://kiosk.test' });
			expect(response.status).toBe(401);
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://kiosk.test');
		});

		it.each([
			['wrong password', basic('kiosk', 'nope')],
			['wrong user', basic('admin', PASSWORD)],
			['empty password', basic('kiosk', '')],
			['wrong scheme', `Bearer ${btoa(`kiosk:${PASSWORD}`)}`],
			['malformed base64', 'Basic !!!not-base64!!!'],
			['missing colon', `Basic ${btoa('kioskpassword')}`],
			['non UTF-8 bytes', `Basic ${btoa(String.fromCharCode(0x6b, 0x3a, 0xff, 0xfe))}`],
			['no credentials after the scheme', 'Basic'],
			['a prefix of the right password', basic('kiosk', PASSWORD.slice(0, -1))],
			['the password with extra characters', basic('kiosk', `${PASSWORD}x`)],
		])('rejects %s', async (_name, authorization) => {
			const response = await get('/', on, authorization);

			expect(response.status).toBe(401);
			expect(assetRequests).toHaveLength(0);
		});

		it('accepts the scheme in any case and a password containing colons', async () => {
			const env: Env = { ...on, KIOSK_PASSWORD: 'a:b:c:d:e:f:g:h:i' };
			const response = await get('/', env, basic('kiosk', 'a:b:c:d:e:f:g:h:i').replace('Basic', 'bAsIc'));
			expect(response.status).toBe(200);
		});

		it('round-trips a non-ASCII password as UTF-8', async () => {
			const env: Env = { ...on, KIOSK_PASSWORD: 'contraseña-ñandú-日本語-🔐' };

			expect((await get('/', env, basic('kiosk', 'contraseña-ñandú-日本語-🔐'))).status).toBe(200);
			expect((await get('/', env, basic('kiosk', 'contrasena'))).status).toBe(401);
		});

		it('uses KIOSK_USER when set and falls back to kiosk when it is empty', async () => {
			expect((await get('/', { ...on, KIOSK_USER: 'tablet' }, basic('tablet', PASSWORD))).status).toBe(200);
			expect((await get('/', { ...on, KIOSK_USER: 'tablet' }, GOOD)).status).toBe(401);
			expect((await get('/', { ...on, KIOSK_USER: '' }, GOOD)).status).toBe(200);
		});

		it('does not touch assets for an OPTIONS preflight', async () => {
			const response = await call('/', { env: on, method: 'OPTIONS', key: null });
			expect(response.status).toBe(204);
			expect(assetRequests).toHaveLength(0);
		});

		it.each([
			['HEAD /', '/', 'HEAD'],
			['an upper-case API path', '/API/seal', 'POST'],
			['a double-slash API path', '//api/seal', 'POST'],
			['an unknown API route', '/api/x', 'GET'],
		])('answers 401 without credentials for %s', async (_name, path, httpMethod) => {
			const response = await call(path, { env: on, method: httpMethod, key: 'key-1' });

			expect(response.status).toBe(401);
			expect(upstreamCalls).toHaveLength(0);
			expect(assetRequests).toHaveLength(0);
		});

		it('trims the secret so a trailing newline is not part of the password', async () => {
			const env: Env = { ...on, KIOSK_PASSWORD: `${PASSWORD}\n` };

			expect((await get('/', env, GOOD)).status).toBe(200);
			expect((await get('/', env, basic('kiosk', `${PASSWORD}\n`))).status).toBe(401);
		});

		it('answers an OPTIONS preflight with 204 without credentials', async () => {
			const response = await call('/api/employees', { env: on, method: 'OPTIONS', key: null, headers: { Origin: 'https://kiosk.test' } });

			expect(response.status).toBe(204);
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://kiosk.test');
		});

		it('consults the rate limiter before the credentials, for pages too', async () => {
			const limit = vi.fn(async () => ({ success: false }));
			const env: Env = { ...on, RATE_LIMITER: { limit } };

			for (const path of ['/', '/api/employees']) {
				const response = await get(path, env, 'Basic !!!', { 'CF-Connecting-IP': '203.0.113.9' });
				expect(response.status).toBe(429);
				expect(response.headers.get('WWW-Authenticate')).toBeNull();
			}
			expect(limit).toHaveBeenCalledTimes(2);
			expect(limit).toHaveBeenCalledWith({ key: '203.0.113.9' });
		});

		it('throttles wrong guesses per IP but still checks credentials when under the limit', async () => {
			const env: Env = { ...on, RATE_LIMITER: { limit: async () => ({ success: true }) } };
			expect((await get('/', env, basic('kiosk', 'bad'))).status).toBe(401);
			expect((await get('/', env, GOOD)).status).toBe(200);
		});
	});
	describe('when KIOSK_PASSWORD is shorter than 16 characters', () => {
		const short: Env = { ...on, KIOSK_PASSWORD: 'a'.repeat(15) };

		it.each([
			['the page', '/'],
			['an asset', '/assets/index-abc.js'],
			['an API route', '/api/employees'],
		])('fails closed with 500 for %s, with zero upstream or asset calls', async (_name, path) => {
			const response = await get(path, short, basic('kiosk', 'a'.repeat(15)));

			expect(response.status).toBe(500);
			expect(await response.json()).toEqual({ error: 'KIOSK_PASSWORD must be at least 16 characters' });
			expect(upstreamCalls).toHaveLength(0);
			expect(assetRequests).toHaveLength(0);
		});

		it('counts the trimmed length', async () => {
			const env: Env = { ...on, KIOSK_PASSWORD: `  ${'a'.repeat(15)}\n` };
			expect((await get('/', env)).status).toBe(500);
			expect((await get('/', { ...on, KIOSK_PASSWORD: `${'a'.repeat(16)}\n` }, basic('kiosk', 'a'.repeat(16)))).status).toBe(200);
		});

		it('still answers an OPTIONS preflight', async () => {
			const response = await call('/api/employees', { env: short, method: 'OPTIONS', key: null });
			expect(response.status).toBe(204);
		});
	});

	it('keeps asset protection configured in wrangler.toml', () => {
		const toml = wranglerToml.replace(/^\s*#.*$/gm, '');
		const assets = /^\[assets\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml)?.[1] ?? '';

		expect(assets).toMatch(/^\s*run_worker_first\s*=\s*true\s*$/m);
		expect(assets).toMatch(/^\s*binding\s*=\s*"ASSETS"\s*$/m);
	});
});
