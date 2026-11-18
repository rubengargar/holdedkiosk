import type { Env } from './env';

const DEFAULT_USER = 'kiosk';

export const CHALLENGE = 'Basic realm="Kiosk for Holded", charset="UTF-8"';

export const MIN_PASSWORD_LENGTH = 16;

const kioskPassword = (env: Env): string => (env.KIOSK_PASSWORD ?? '').trim();

export const kioskAuthEnabled = (env: Env): boolean => kioskPassword(env) !== '';

export const kioskPasswordTooShort = (env: Env): boolean => kioskAuthEnabled(env) && kioskPassword(env).length < MIN_PASSWORD_LENGTH;

const sha256 = async (text: string): Promise<Uint8Array> =>
	new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

function digestsEqual(a: Uint8Array, b: Uint8Array): boolean {
	let diff = a.length ^ b.length;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ (b[i] ?? 0);
	return diff === 0;
}

function parseBasic(header: string | null): { user: string; password: string } | null {
	const match = /^basic +(\S+)$/i.exec(header ?? '');
	if (!match) return null;
	try {
		const bytes = Uint8Array.from(atob(match[1]), (char) => char.charCodeAt(0));
		const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
		const colon = decoded.indexOf(':');
		return colon < 0 ? null : { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
	} catch {
		return null;
	}
}

export async function kioskAuthorized(request: Request, env: Env): Promise<boolean> {
	if (!kioskAuthEnabled(env)) return true;
	const expected = kioskPassword(env);
	const given = parseBasic(request.headers.get('Authorization'));
	if (!given) return false;
	const [givenUser, expectedUser, givenPassword, expectedPassword] = await Promise.all([
		sha256(given.user),
		sha256(env.KIOSK_USER || DEFAULT_USER),
		sha256(given.password),
		sha256(expected),
	]);
	const userOk = digestsEqual(givenUser, expectedUser);
	const passwordOk = digestsEqual(givenPassword, expectedPassword);
	return userOk && passwordOk;
}
