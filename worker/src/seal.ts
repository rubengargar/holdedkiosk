import type { Env } from './env';
import { HttpError } from './errors';

const PREFIX = 'sealed.v1.';
const CURRENT_NAME = 'sealing-key-current';
const AAD = new TextEncoder().encode('holded-kiosk/v1');
const IV_BYTES = 12;
const KEY_BYTES = 32;

export const SEALED_TOKEN_INVALID = 'Sealed token is not valid for this kiosk';

const invalid = () => new HttpError(401, SEALED_TOKEN_INVALID);

const toBase64Url = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

function fromBase64Url(text: string): Uint8Array {
	const padded = text.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
	return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

const KID_BYTES = 8;
const KID_SHAPE = /^[A-Za-z0-9_-]{11}$/;
const keyName = (kid: string) => `sealing-key:${kid}`;

const unavailable = () => new HttpError(503, 'Sealing is not available on this Worker');
const notYet = () => new HttpError(503, 'Sealing key is not available yet, try again in a minute');

const importKey = (raw: string) => crypto.subtle.importKey('raw', fromBase64Url(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);

interface Sealer {
	kid: string;
	key: CryptoKey;
}

// KV has no put-if-absent, so a stored key is never overwritten: every first writer keeps its own key under its own kid.
// Per binding, so a steady-state request costs no KV read. A kid that is not found is never cached.
const known = new WeakMap<KVNamespace, Map<string, CryptoKey>>();
const current = new WeakMap<KVNamespace, Promise<Sealer>>();

function cacheOf(kv: KVNamespace): Map<string, CryptoKey> {
	let byKid = known.get(kv);
	if (!byKid) known.set(kv, (byKid = new Map()));
	return byKid;
}

async function keyFor(kv: KVNamespace, kid: string): Promise<CryptoKey> {
	const byKid = cacheOf(kv);
	let key = byKid.get(kid);
	if (!key) {
		const stored = await kv.get(keyName(kid));
		if (stored === null) throw notYet();
		key = await importKey(stored);
		byKid.set(kid, key);
	}
	return key;
}

async function createSealer(kv: KVNamespace): Promise<Sealer> {
	const kid = await kv.get(CURRENT_NAME);
	if (kid !== null) return { kid, key: await keyFor(kv, kid) };
	const fresh = toBase64Url(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
	const freshKid = toBase64Url(crypto.getRandomValues(new Uint8Array(KID_BYTES)));
	await kv.put(keyName(freshKid), fresh);
	await kv.put(CURRENT_NAME, freshKid);
	const key = await importKey(fresh);
	cacheOf(kv).set(freshKid, key);
	return { kid: freshKid, key };
}

function currentSealer(kv: KVNamespace): Promise<Sealer> {
	let sealer = current.get(kv);
	if (!sealer) {
		sealer = createSealer(kv);
		current.set(kv, sealer);
		sealer.catch(() => current.delete(kv));
	}
	return sealer;
}

export async function seal(env: Env, key: string): Promise<string> {
	if (!env.KIOSK_KEYS) throw unavailable();
	const { kid, key: cryptoKey } = await currentSealer(env.KIOSK_KEYS);
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, cryptoKey, new TextEncoder().encode(key));
	return `${PREFIX}${kid}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

export const isSealed = (token: string): boolean => token.startsWith('sealed.');

export async function unseal(env: Env, token: string): Promise<string> {
	const kv = env.KIOSK_KEYS;
	if (!kv) throw unavailable();
	if (!token.startsWith(PREFIX)) throw invalid();
	const [kid, iv, encrypted, ...rest] = token.slice(PREFIX.length).split('.');
	if (rest.length > 0 || iv === undefined || encrypted === undefined || !KID_SHAPE.test(kid)) throw invalid();
	const cryptoKey = await keyFor(kv, kid);
	try {
		const plain = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: fromBase64Url(iv), additionalData: AAD },
			cryptoKey,
			fromBase64Url(encrypted)
		);
		return new TextDecoder().decode(plain);
	} catch {
		throw invalid();
	}
}
