import { createServer } from 'node:http';

const FIRST = ['Ana', 'Luis', 'Marta', 'Jorge', 'Elena', 'Pablo', 'Lucia', 'Raul', 'Sara', 'Diego', 'Irene', 'Hugo'];
const LAST = ['Garcia', 'Lopez', 'Ruiz', 'Navarro', 'Torres', 'Vega', 'Castro', 'Ortiz', 'Mora', 'Gil', 'Soler', 'Pons'];
const HOUR = 3_600_000;

const companies = new Map();
const calls = { total: 0, byPath: {} };

function hash(text) {
	let h = 5381;
	for (const char of text) h = (h * 33 + char.charCodeAt(0)) >>> 0;
	return h;
}

function seed(key) {
	const h = hash(key);
	const hex = (n) => n.toString(16).padStart(8, '0');
	const employees = Array.from({ length: 6 }, (_, i) => ({
		id: `${hex(h)}${hex(h * (i + 3) >>> 0)}${hex(i + 1)}`,
		full_name: `${FIRST[(h + i * 5) % FIRST.length]} ${LAST[(h + i * 7) % LAST.length]}`,
		terminated: i === 4 ? 1_700_000_000 : null,
		current_contract: i === 5 ? null : { id: `contract-${i}`, salary: 30000 + i * 1000 },
		iban: `ES91210000${h}${i}`,
		social_security_number: `28/${h % 100000000}${i}`,
		salary: 30000 + i * 1000,
		address: { street: `Calle Falsa ${i + 1}`, city: 'Madrid' },
	}));

	const now = Date.now();
	const entry = (employee, startHoursAgo, endHoursAgo) => ({
		id: `t-${employee}-${startHoursAgo}`,
		employee_id: employees[employee].id,
		start_at: new Date(now - startHoursAgo * HOUR).toISOString(),
		end_at: endHoursAgo === null ? null : new Date(now - endHoursAgo * HOUR).toISOString(),
		status: endHoursAgo === null ? 'running' : 'done',
	});
	const times = [entry(3, 0.5, null), entry(2, 2, null), entry(1, 5, 3), entry(0, 7, 4), entry(1, 30, 26), entry(0, 31, 27)];
	return { employees, times };
}

const company = (key) => {
	if (!companies.has(key)) companies.set(key, seed(key));
	return companies.get(key);
};

function send(res, status, body) {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
}

const problem = (res, status, title, detail) => send(res, status, { type: 'about:blank', title, status, detail });

function paginate(items, url) {
	const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
	const offset = Number(url.searchParams.get('cursor')) || 0;
	const end = offset + limit;
	return { items: items.slice(offset, end), has_more: end < items.length, cursor: end < items.length ? String(end) : null };
}

function account(key) {
	const h = hash(key);
	return {
		id: `acc-${h}`,
		name: `Razon Social ${key} SL`,
		trade_name: h % 2 === 0 ? `Comercial ${key}` : '',
		website: `https://${key}.example`,
		logo: `/box/account/${h.toString(16)}?p=${h.toString(16)}`,
		tax_id: `B${h}`,
	};
}

function route(req, res, url, state, key) {
	if (req.method === 'GET' && url.pathname === '/api/v2/account') return send(res, 200, account(key));

	const clockMatch = /^\/api\/v2\/employees\/([^/]+)\/(clock-in|clock-out|pause|unpause)$/.exec(url.pathname);

	if (req.method === 'GET' && url.pathname === '/api/v2/employees') return send(res, 200, paginate(state.employees, url));
	if (req.method === 'GET' && url.pathname === '/api/v2/employee-times') return send(res, 200, paginate(state.times, url));

	if (req.method === 'POST' && clockMatch) {
		const [, id, action] = clockMatch;
		if (!state.employees.some((employee) => employee.id === id)) return problem(res, 404, 'Not Found', 'Employee not found');
		const running = state.times.find((time) => time.employee_id === id && time.end_at === null);
		if (action === 'clock-in') {
			if (running) return problem(res, 400, 'Bad Request', 'A time entry is already running');
			const created = { id: `t-${Date.now()}`, employee_id: id, start_at: new Date().toISOString(), end_at: null, status: 'running' };
			state.times.unshift(created);
			return send(res, 201, { id: created.id });
		}
		if (!running) return problem(res, 404, 'Not Found', 'No running time entry');
		if (action === 'pause' || action === 'unpause') {
			running.status = action === 'pause' ? 'paused' : 'running';
			return send(res, 200, { id: running.id });
		}
		running.end_at = new Date().toISOString();
		running.status = 'done';
		return send(res, 200, { id: running.id });
	}

	return problem(res, 404, 'Not Found', 'Unknown route');
}

const server = createServer((req, res) => {
	const url = new URL(req.url, 'http://mock');

	if (req.method === 'GET' && url.pathname === '/__calls') return send(res, 200, calls);
	if (req.method === 'POST' && url.pathname === '/__reset') {
		calls.total = 0;
		calls.byPath = {};
		return send(res, 200, { ok: true });
	}

	const path = url.pathname.replace(/^(\/api\/v2\/employees\/)[^/]+/, '$1:id');
	calls.total++;
	calls.byPath[path] = (calls.byPath[path] ?? 0) + 1;

	const match = /^Bearer (key-.+)$/.exec(req.headers.authorization ?? '');
	if (!match) return problem(res, 401, 'Unauthorized', 'Invalid API key');
	route(req, res, url, company(match[1]), match[1]);
});

const port = Number(process.argv[2]) || 8788;
server.listen(port, '127.0.0.1', () => console.log(`mock holded v2 on http://127.0.0.1:${port}`));
