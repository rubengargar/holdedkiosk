const EMPLOYEES_TTL_MS = 24 * 60 * 60 * 1000;
const STATUS_TTL_MS = 30 * 60 * 1000;
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Holded-API-Key, X-Client-Timezone',
};
async function handleOptions(request) {
    if (request.headers.get('Origin') !== null &&
        request.headers.get('Access-Control-Request-Method') !== null &&
        request.headers.get('Access-Control-Request-Headers') !== null) {
        return new Response(null, {
            headers: corsHeaders,
            status: 200,
        });
    }
    return new Response(null, {
        headers: {
            Allow: 'GET, POST, OPTIONS',
        },
        status: 204,
    });
}
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}
function getTimezone(request) {
    return request.headers.get('X-Client-Timezone') || 'UTC';
}
async function hashValue(value) {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}
function createCacheRequest(request, key) {
    const url = new URL(request.url);
    return new Request(`${url.origin}/__cache/${key}`);
}
async function readCacheEnvelope(request, key) {
    const cache = caches.default;
    const cachedResponse = await cache.match(createCacheRequest(request, key));
    if (!cachedResponse) {
        return null;
    }
    try {
        return (await cachedResponse.json());
    }
    catch {
        return null;
    }
}
async function writeCacheEnvelope(request, key, data) {
    const cache = caches.default;
    const cacheResponse = new Response(JSON.stringify({
        cachedAt: Date.now(),
        data,
    }), {
        headers: {
            'Content-Type': 'application/json',
        },
    });
    await cache.put(createCacheRequest(request, key), cacheResponse);
}
async function deleteCacheEntry(request, key) {
    await caches.default.delete(createCacheRequest(request, key));
}
function isCacheFresh(envelope, ttlMs) {
    return !!envelope && Date.now() - envelope.cachedAt < ttlMs;
}
async function fetchHoldedJson(holdedApiKey, path, init) {
    const response = await fetch(`https://api.holded.com${path}`, {
        ...init,
        headers: {
            accept: 'application/json',
            'Content-Type': 'application/json',
            key: holdedApiKey,
            ...(init?.headers || {}),
        },
    });
    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`${response.status}: ${errorData}`);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : {});
}
function isActiveEmployee(employee) {
    const isTerminated = employee.terminated !== null && employee.terminated !== undefined && employee.terminated !== '';
    const hasValidContract = employee.currentContract && typeof employee.currentContract === 'object' && !Array.isArray(employee.currentContract);
    return !isTerminated && !!hasValidContract;
}
function getEmployeeName(employee) {
    return `${employee.name || ''} ${employee.lastName || ''}`.trim() || 'Empleado Desconocido';
}
function getDateKey(timestampMs, timezone) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    })
        .format(new Date(timestampMs))
        .replace(/\//g, '-');
}
function summarizeEmployeeTimes(timesResponse, employee, timezone) {
    const timeEntries = Array.isArray(timesResponse?.employeesTimeTracking)
        ? timesResponse.employeesTimeTracking
        : Array.isArray(timesResponse?.data)
            ? timesResponse.data
            : [];
    const todayKey = getDateKey(Date.now(), timezone);
    let isClockedIn = false;
    let isPaused = false;
    let totalTrackedMsToday = 0;
    for (const entry of timeEntries) {
        if (!entry || typeof entry.start !== 'number') {
            continue;
        }
        const clockInTimestamp = entry.start * 1000;
        if (getDateKey(clockInTimestamp, timezone) !== todayKey) {
            continue;
        }
        const status = typeof entry.status === 'string' ? entry.status.toLowerCase() : '';
        const isRunning = entry.end === 0 || status === 'running' || status === 'paused';
        const clockOutTimestamp = isRunning ? Date.now() : entry.end * 1000;
        totalTrackedMsToday += Math.max(0, clockOutTimestamp - clockInTimestamp);
        if (isRunning) {
            isClockedIn = true;
        }
        if (status === 'paused') {
            isPaused = true;
        }
    }
    const hours = Math.floor(totalTrackedMsToday / (1000 * 60 * 60));
    const minutes = Math.floor((totalTrackedMsToday % (1000 * 60 * 60)) / (1000 * 60));
    return {
        id: employee.id,
        name: getEmployeeName(employee),
        isClockedIn,
        isPaused: isClockedIn && isPaused,
        trackedTimeToday: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    };
}
async function getActiveEmployees(request, holdedApiKey, forceRefresh) {
    const tokenHash = await hashValue(holdedApiKey);
    const cacheKey = `employees/${tokenHash}`;
    const cached = await readCacheEnvelope(request, cacheKey);
    if (!forceRefresh && isCacheFresh(cached, EMPLOYEES_TTL_MS)) {
        return cached.data;
    }
    try {
        let allEmployees = [];
        let page = 1;
        const perPage = 50;
        let moreEmployeesExist = true;
        while (moreEmployeesExist) {
            const data = await fetchHoldedJson(holdedApiKey, `/api/team/v1/employees?page=${page}&perPage=${perPage}`);
            if (!data || !Array.isArray(data.employees)) {
                throw new Error('Unexpected response format when fetching employees');
            }
            allEmployees = allEmployees.concat(data.employees);
            if (data.employees.length < perPage) {
                moreEmployeesExist = false;
            }
            else {
                page++;
            }
        }
        const activeEmployees = allEmployees.filter(isActiveEmployee);
        await writeCacheEnvelope(request, cacheKey, activeEmployees);
        return activeEmployees;
    }
    catch (error) {
        if (cached) {
            return cached.data;
        }
        throw error;
    }
}
async function getEmployeeStatusSummary(request, holdedApiKey, employee, timezone, forceRefresh) {
    const tokenHash = await hashValue(holdedApiKey);
    const timezoneHash = await hashValue(timezone);
    const cacheKey = `status/${tokenHash}/${timezoneHash}/${employee.id}`;
    const cached = await readCacheEnvelope(request, cacheKey);
    if (!forceRefresh && isCacheFresh(cached, STATUS_TTL_MS)) {
        return cached.data;
    }
    try {
        const timesResponse = await fetchHoldedJson(holdedApiKey, `/api/team/v1/employees/${employee.id}/times`);
        const summary = summarizeEmployeeTimes(timesResponse, employee, timezone);
        await writeCacheEnvelope(request, cacheKey, summary);
        return summary;
    }
    catch (error) {
        if (cached) {
            return cached.data;
        }
        throw error;
    }
}
async function postHoldedTimeAction(holdedApiKey, employeeId, action) {
    return fetchHoldedJson(holdedApiKey, `/api/team/v1/employees/${employeeId}/times/${action}`, {
        method: 'POST',
    });
}
async function refreshEmployeeStatusCache(request, holdedApiKey, employeeId, timezone) {
    const employees = await getActiveEmployees(request, holdedApiKey, false);
    const employee = employees.find((item) => item.id === employeeId);
    if (!employee) {
        throw new Error('Employee not found in active employees cache');
    }
    return getEmployeeStatusSummary(request, holdedApiKey, employee, timezone, true);
}
export default {
    async fetch(request, env, ctx) {
        void env;
        void ctx;
        const url = new URL(request.url);
        if (request.method === 'OPTIONS') {
            return handleOptions(request);
        }
        const holdedApiKey = request.headers.get('X-Holded-API-Key');
        if (!holdedApiKey) {
            return jsonResponse({ error: 'No token provided' }, 401);
        }
        const timezone = getTimezone(request);
        const forceRefresh = url.searchParams.get('forceRefresh') === '1';
        if (url.pathname === '/api/dashboard' && request.method === 'GET') {
            try {
                const employees = await getActiveEmployees(request, holdedApiKey, forceRefresh);
                const employeeSummaries = await Promise.all(employees.map((employee) => getEmployeeStatusSummary(request, holdedApiKey, employee, timezone, forceRefresh)));
                employeeSummaries.sort((a, b) => a.name.localeCompare(b.name));
                return jsonResponse(employeeSummaries);
            }
            catch (error) {
                console.error('Error fetching dashboard:', error);
                return jsonResponse({ error: 'Internal server error while fetching dashboard', details: error.message }, 500);
            }
        }
        const actionMatch = url.pathname.match(/^\/api\/employees\/([^/]+)\/(clockin|clockout|pause|unpause)$/);
        if (actionMatch && request.method === 'POST') {
            const employeeId = actionMatch[1];
            const action = actionMatch[2];
            try {
                await postHoldedTimeAction(holdedApiKey, employeeId, action);
                const summary = await refreshEmployeeStatusCache(request, holdedApiKey, employeeId, timezone);
                return jsonResponse(summary);
            }
            catch (error) {
                console.error(`Error during ${action} action:`, error);
                return jsonResponse({ error: `Failed to ${action}`, details: error.message }, error.message?.match(/^\d{3}:/) ? Number(error.message.slice(0, 3)) : 500);
            }
        }
        const invalidateMatch = url.pathname.match(/^\/api\/employees\/([^/]+)\/status-cache$/);
        if (invalidateMatch && request.method === 'POST') {
            const employeeId = invalidateMatch[1];
            try {
                const tokenHash = await hashValue(holdedApiKey);
                const timezoneHash = await hashValue(timezone);
                await deleteCacheEntry(request, `status/${tokenHash}/${timezoneHash}/${employeeId}`);
                return jsonResponse({ ok: true });
            }
            catch (error) {
                console.error('Error invalidating status cache:', error);
                return jsonResponse({ error: 'Failed to invalidate status cache', details: error.message }, 500);
            }
        }
        return new Response('Not Found', { status: 404, headers: corsHeaders });
    },
};
