export interface Env {
	ALLOWED_ORIGINS?: string;
	HOLDED_API_BASE?: string;
	RATE_LIMITER?: RateLimit;
	KIOSK_KEYS?: KVNamespace;
	KIOSK_PASSWORD?: string;
	KIOSK_USER?: string;
	ASSETS?: Fetcher;
}
