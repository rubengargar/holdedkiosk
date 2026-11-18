import type { Env } from './env';

export interface Employee {
	id: string;
	name: string;
}

export interface TimeEntry {
	employeeId: string;
	start: number;
	end: number | null;
	paused: boolean;
}

export class HoldedError extends Error {
	constructor(
		readonly status: number,
		readonly detail?: string,
		readonly retryAfter?: string
	) {
		super(detail ?? `Holded error ${status}`);
	}
}

const DEFAULT_BASE = 'https://api.holded.com';
const PAGE_SIZE = 200;
const MAX_TIME_PAGES = 5;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export type ClockAction = 'clock-in' | 'clock-out' | 'pause' | 'unpause';

const unexpected = () => new HoldedError(502, 'Unexpected response from Holded');

async function call(env: Env, key: string, path: string, method: 'GET' | 'POST' = 'GET'): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch(`${env.HOLDED_API_BASE ?? DEFAULT_BASE}${path}`, {
			method,
			headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
		});
	} catch {
		throw new HoldedError(502, 'Holded is unreachable');
	}

	const body: unknown = await response.json().catch(() => undefined);
	if (response.ok) return body;

	const detail = isRecord(body) && typeof body.detail === 'string' ? body.detail : undefined;
	const clientError = response.status >= 400 && response.status < 500;
	throw new HoldedError(clientError ? response.status : 502, detail, response.headers.get('retry-after') ?? undefined);
}

interface Page {
	items: unknown[];
	next: string | undefined;
}

async function fetchPage(env: Env, key: string, path: string, cursor: string | undefined): Promise<Page> {
	const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
	if (cursor) query.set('cursor', cursor);
	const body = await call(env, key, `${path}?${query}`);

	if (!isRecord(body) || !Array.isArray(body.items) || typeof body.has_more !== 'boolean') throw unexpected();
	if (!body.has_more) return { items: body.items, next: undefined };
	if (typeof body.cursor !== 'string') throw unexpected();
	return { items: body.items, next: body.cursor };
}

function parseEmployee(item: unknown): Employee | null {
	if (!isRecord(item) || typeof item.id !== 'string' || typeof item.full_name !== 'string') throw unexpected();
	const active = item.terminated == null && item.current_contract != null;
	return active ? { id: item.id, name: item.full_name } : null;
}

function parseInstant(value: unknown): number {
	const ms = typeof value === 'string' ? Date.parse(value) : NaN;
	if (!Number.isFinite(ms)) throw unexpected();
	return ms;
}

// Unverified: the v2 spec lists only "running, done"; v1 reported "paused" and this assumes v2 does too.
const isPaused = (status: unknown): boolean => typeof status === 'string' && status.toLowerCase() === 'paused';

function parseEntry(item: unknown): TimeEntry {
	if (!isRecord(item) || typeof item.employee_id !== 'string') throw unexpected();
	return {
		employeeId: item.employee_id,
		start: parseInstant(item.start_at),
		end: item.end_at == null ? null : parseInstant(item.end_at),
		paused: item.end_at == null && isPaused(item.status),
	};
}

export async function listActiveEmployees(env: Env, key: string): Promise<Employee[]> {
	const employees: Employee[] = [];
	let cursor: string | undefined;
	do {
		const page = await fetchPage(env, key, '/api/v2/employees', cursor);
		for (const item of page.items) {
			const employee = parseEmployee(item);
			if (employee) employees.push(employee);
		}
		cursor = page.next;
	} while (cursor);
	return employees;
}

export async function listEntriesSince(env: Env, key: string, sinceMs: number): Promise<TimeEntry[]> {
	const entries: TimeEntry[] = [];
	let cursor: string | undefined;
	for (let fetched = 0; fetched < MAX_TIME_PAGES; fetched++) {
		const page = await fetchPage(env, key, '/api/v2/employee-times', cursor);
		const parsed = page.items.map(parseEntry);
		entries.push(...parsed);
		const oldest = Math.min(...parsed.map((entry) => entry.start));
		if (!page.next || oldest < sinceMs) break;
		cursor = page.next;
	}
	return entries.filter((entry) => entry.start >= sinceMs || entry.end === null);
}

export async function clock(env: Env, key: string, employeeId: string, action: ClockAction): Promise<void> {
	await call(env, key, `/api/v2/employees/${employeeId}/${action}`, 'POST');
}
