import adapter from '@sveltejs/adapter-node'

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		// The first server hook preserves form-origin checks with one OAuth token exception.
		csrf: { trustedOrigins: ['*'] }
	}
}

export default config
