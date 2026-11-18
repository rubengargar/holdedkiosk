import type { Env } from './env';
import { HttpError } from './errors';
import { HoldedError, clock, type ClockAction, getAccountInfo, listActiveEmployees, listEntriesSince } from './holded';
import { CHALLENGE, MIN_PASSWORD_LENGTH, kioskAuthEnabled, kioskAuthorized, kioskPasswordTooShort } from './kiosk-auth';
import { isSealed, seal, unseal } from './seal';

interface Context {
	env: Env;
	key: string;
	url: URL;
	params: string[];
}

interface Route {
	method: string;
	pattern: RegExp;
	plainKey?: boolean;
	handler: (context: Context) => Promise<unknown>;
}

const EMPLOYEE_ID = /^[a-f0-9]{24}$/;

const CLOCK_ACTIONS: ClockAction[] = ['clock-in', 'clock-out', 'pause', 'unpause'];

const clockRoute = (action: ClockAction): Route => ({
	method: 'POST',
	pattern: new RegExp(`^/api/employees/([^/]+)/${action}$`),
	handler: async ({ env, key, params: [id] }) => {
		if (!EMPLOYEE_ID.test(id)) throw new HttpError(400, 'Invalid employee id');
		await clock(env, key, id, action);
		return { ok: true };
	},
});

const routes: Route[] = [
	{
		method: 'POST',
		pattern: /^\/api\/seal$/,
		plainKey: true,
		handler: async ({ env, key }) => {
			if (isSealed(key)) throw new HttpError(400, 'Expected a plain Holded API key');
			const token = await seal(env, key);
			return { token, employees: await listActiveEmployees(env, key) };
		},
	},
	{ method: 'GET', pattern: /^\/api\/account$/, handler: ({ env, key }) => getAccountInfo(env, key) },
	{ method: 'GET', pattern: /^\/api\/employees$/, handler: ({ env, key }) => listActiveEmployees(env, key) },
	{
		method: 'GET',
		pattern: /^\/api\/times$/,
		handler: ({ env, key, url }) => {
			const since = url.searchParams.get('since');
			const sinceMs = since ? Number(since) : NaN;
			if (!Number.isFinite(sinceMs)) throw new HttpError(400, 'since must be a number of epoch milliseconds');
			return listEntriesSince(env, key, sinceMs);
		},
	},
	...CLOCK_ACTIONS.map(clockRoute),
];

const RATE_LIMIT_RETRY_AFTER = '60';

function apiHeaders(request: Request, env: Env): Headers {
	const headers = new Headers({
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
		Vary: 'Origin',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'x-holded-api-key, content-type',
		'Access-Control-Expose-Headers': 'Retry-After',
		'Access-Control-Max-Age': '86400',
	});
	const origin = request.headers.get('Origin');
	const allowed = (env.ALLOWED_ORIGINS ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (origin && allowed.includes(origin)) headers.set('Access-Control-Allow-Origin', origin);
	return headers;
}

async function withinRateLimit(env: Env, ip: string): Promise<boolean> {
	if (!env.RATE_LIMITER) return true;
	try {
		return (await env.RATE_LIMITER.limit({ key: ip })).success;
	} catch {
		return true;
	}
}

function json(body: unknown, status: number, headers: Headers): Response {
	headers.set('Content-Type', 'application/json');
	return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(error: unknown, headers: Headers): Response {
	if (error instanceof HoldedError) {
		if (error.retryAfter) headers.set('Retry-After', error.retryAfter);
		return json({ error: 'Holded request failed', detail: error.detail }, error.status, headers);
	}
	if (error instanceof HttpError) return json({ error: error.message }, error.status, headers);
	return json({ error: 'Internal error' }, 500, headers);
}

async function dispatch(request: Request, env: Env): Promise<unknown> {
	const key = request.headers.get('X-Holded-API-Key');
	if (!key) throw new HttpError(401, 'Missing X-Holded-API-Key header');

	const url = new URL(request.url);
	for (const route of routes) {
		const match = route.method === request.method ? route.pattern.exec(url.pathname) : null;
		if (match) {
			const holdedKey = route.plainKey || !isSealed(key) ? key : await unseal(env, key);
			return route.handler({ env, key: holdedKey, url, params: match.slice(1) });
		}
	}
	throw new HttpError(404, 'Not found');
}

const isApi = (url: URL): boolean => url.pathname === '/api' || url.pathname.startsWith('/api/');

function unauthorized(headers: Headers): Response {
	headers.set('WWW-Authenticate', CHALLENGE);
	return new Response(null, { status: 401, headers });
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const api = isApi(url);
		const headers = apiHeaders(request, env);

		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

		if (kioskPasswordTooShort(env)) return json({ error: `KIOSK_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters` }, 500, headers);

		try {
			if (api || kioskAuthEnabled(env)) {
				const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
				if (!(await withinRateLimit(env, ip))) {
					headers.set('Retry-After', RATE_LIMIT_RETRY_AFTER);
					return json({ error: 'Too many requests' }, 429, headers);
				}
			}

			if (!(await kioskAuthorized(request, env))) return unauthorized(api ? headers : new Headers({ 'Cache-Control': 'no-store' }));

			if (api) return json(await dispatch(request, env), 200, headers);
			if (!env.ASSETS) return json({ error: 'Not found' }, 404, headers);
			return env.ASSETS.fetch(request);
		} catch (error) {
			return errorResponse(error, headers);
		}
	},
};
