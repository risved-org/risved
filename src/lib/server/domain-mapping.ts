/** Validate a canonical, literal mount path; reject ambiguous URL encodings and matchers. */
export function parseMapping(
	pathPrefix: unknown = '/',
	forwardingMode: unknown = 'preserve'
): { pathPrefix: string; forwardingMode: 'preserve' | 'strip' } {
	if (
		typeof pathPrefix !== 'string' ||
		(pathPrefix !== '/' &&
			!/^\/(?:[A-Za-z0-9_~-]+(?:\.[A-Za-z0-9_~-]+)*)(?:\/[A-Za-z0-9_~-]+(?:\.[A-Za-z0-9_~-]+)*)*$/.test(
				pathPrefix
			))
	) {
		throw new Error(
			'Path prefix must be / or a path such as /blog without a trailing slash, query or fragment'
		)
	}
	if (forwardingMode !== 'preserve' && forwardingMode !== 'strip') {
		throw new Error('Forwarding mode must be preserve or strip')
	}
	return { pathPrefix, forwardingMode }
}

/** Recognize SQLite uniqueness failures, including Drizzle's wrapped driver error. */
export function isMappingConflict(error: unknown): boolean {
	if (!(error instanceof Error)) return false
	return (
		/UNIQUE constraint failed: domains\.(hostname|path_prefix)/.test(error.message) ||
		isMappingConflict(error.cause)
	)
}
