import type { Env } from './env';
import { HoldedError, clock, type ClockAction, listActiveEmployees, listEntriesSince } from './holded';

class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

interface Context {
	env: Env;
	key: string;
	url: URL;
	params: string[];
}

interface Route {
	method: string;
	pattern: RegExp;
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

function corsHeaders(request: Request, env: Env): Headers {
	const headers = new Headers({
		Vary: 'Origin',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'x-holded-api-key, content-type',
		'Access-Control-Expose-Headers': 'Retry-After',
	});
	const origin = request.headers.get('Origin');
	const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((entry) => entry.trim());
	if (origin && allowed.includes(origin)) headers.set('Access-Control-Allow-Origin', origin);
	return headers;
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
		if (match) return route.handler({ env, key, url, params: match.slice(1) });
	}
	throw new HttpError(404, 'Not found');
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const headers = corsHeaders(request, env);
		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
		try {
			return json(await dispatch(request, env), 200, headers);
		} catch (error) {
			return errorResponse(error, headers);
		}
	},
};
