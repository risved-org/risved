import adapter from 'svelte-adapter-deno'

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter()
	}
}

export default config
