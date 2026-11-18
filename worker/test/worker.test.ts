import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/env';

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

const call = (path: string, init: RequestInit & { key?: string | null } = {}) => {
	const { key = 'key-1', ...rest } = init;
	const headers = new Headers(rest.headers);
	if (key) headers.set('X-Holded-API-Key', key);
	return worker.fetch(new Request(`https://worker.test${path}`, { ...rest, headers }), ENV);
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
