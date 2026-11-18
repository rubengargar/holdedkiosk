import type { Env } from './env';
import { HttpError } from './errors';

const PREFIX = 'sealed.v1.';
const KEY_NAME = 'sealing-key-v1';
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

// Keyed by the binding so a steady-state request costs no KV read.
const keys = new WeakMap<KVNamespace, Promise<CryptoKey>>();

async function loadKey(kv: KVNamespace): Promise<CryptoKey> {
	let stored = await kv.get(KEY_NAME);
	if (stored === null) {
		await kv.put(KEY_NAME, toBase64Url(crypto.getRandomValues(new Uint8Array(KEY_BYTES))));
		// KV has no put-if-absent. Concurrent first writers overwrite each other, so everyone adopts what is stored after the write.
		stored = await kv.get(KEY_NAME);
		if (stored === null) throw new Error('Sealing key was not stored');
	}
	return crypto.subtle.importKey('raw', fromBase64Url(stored), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function sealingKey(env: Env): Promise<CryptoKey> {
	const kv = env.KIOSK_KEYS;
	if (!kv) throw new HttpError(503, 'Sealing is not available on this Worker');
	let key = keys.get(kv);
	if (!key) {
		key = loadKey(kv);
		keys.set(kv, key);
		key.catch(() => keys.delete(kv));
	}
	return key;
}

export async function seal(env: Env, key: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const encrypted = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: AAD },
		await sealingKey(env),
		new TextEncoder().encode(key)
	);
	return `${PREFIX}${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

export const isSealed = (token: string): boolean => token.startsWith('sealed.');

export async function unseal(env: Env, token: string): Promise<string> {
	const cryptoKey = await sealingKey(env);
	try {
		if (!token.startsWith(PREFIX)) throw invalid();
		const [iv, encrypted, ...rest] = token.slice(PREFIX.length).split('.');
		if (rest.length > 0 || iv === undefined || encrypted === undefined) throw invalid();
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
