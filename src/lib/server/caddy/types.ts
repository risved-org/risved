/** Configuration for the Caddy admin API client */
export interface CaddyClientConfig {
	/** Base URL for Caddy's admin API (default: http://localhost:2019) */
	adminUrl?: string;
}

/** A route mapping a hostname to a container port */
export interface CaddyRoute {
	/** The hostname to match (e.g. "myapp.risved.example.eu") */
	hostname: string;
	/** The upstream container port to proxy to */
	port: number;
}

/** Result of a Caddy API operation */
export interface CaddyResult {
	success: boolean;
	error?: string;
}

/** Health check response from Caddy */
export interface CaddyHealthStatus {
	healthy: boolean;
	error?: string;
}

/** Caddy route match configuration */
export interface CaddyMatchConfig {
	host: string[];
}

/** Caddy upstream handler */
export interface CaddyUpstream {
	dial: string;
}

/** Caddy encode handler configuration */
export interface CaddyEncodeHandlerConfig {
	handler: 'encode'
	encodings: Record<string, Record<string, never>>
	prefer: string[]
}

/** Caddy reverse proxy handler configuration */
export interface CaddyReverseProxyHandlerConfig {
	handler: 'reverse_proxy'
	upstreams: CaddyUpstream[]
}

/** Caddy static response handler (used for redirects) */
export interface CaddyStaticResponseHandlerConfig {
	handler: 'static_response'
	status_code: string
	headers: Record<string, string[]>
}

/** Caddy headers handler — sets, adds, or deletes request/response headers */
export interface CaddyHeadersHandlerConfig {
	handler: 'headers'
	response?: {
		set?: Record<string, string[]>
		add?: Record<string, string[]>
		delete?: string[]
		deferred?: boolean
	}
}

/** Caddy subroute handler — runs nested routes with their own match conditions */
export interface CaddySubrouteHandlerConfig {
	handler: 'subroute'
	routes: CaddyRouteConfig[]
}

/** Union of all Caddy handler types */
export type CaddyHandlerConfig =
	| CaddyEncodeHandlerConfig
	| CaddyReverseProxyHandlerConfig
	| CaddyStaticResponseHandlerConfig
	| CaddyHeadersHandlerConfig
	| CaddySubrouteHandlerConfig

/** Caddy path-only matcher (used inside subroutes) */
export interface CaddyPathMatchConfig {
	path: string[]
}

/** Full Caddy route configuration for the JSON API */
export interface CaddyRouteConfig {
	'@id'?: string;
	match?: (CaddyMatchConfig | CaddyPathMatchConfig)[];
	handle: CaddyHandlerConfig[];
}

/** Caddy server configuration */
export interface CaddyServerConfig {
	listen: string[];
	routes: CaddyRouteConfig[];
}

/** Interface for HTTP fetching (allows mocking in tests) */
export interface FetchFn {
	(input: string, init?: RequestInit): Promise<Response>;
}
