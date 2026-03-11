<script lang="ts">
	import { setLocale } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages.js';
</script>

<h1>{m.hello_world({ name: 'SvelteKit User' })}</h1>

<div>
	<button onclick={() => setLocale('en')}>en</button>
	<button onclick={() => setLocale('de')}>de</button>
	<button onclick={() => setLocale('fr')}>fr</button>
	<button onclick={() => setLocale('it')}>it</button>
	<button onclick={() => setLocale('es')}>es</button>
	<button onclick={() => setLocale('pl')}>pl</button>
	<button onclick={() => setLocale('nl')}>nl</button>
	<button onclick={() => setLocale('se')}>se</button>
	<button onclick={() => setLocale('da')}>da</button>
</div>

<p>
	If you use VSCode, install the

	<a
		href="https://marketplace.visualstudio.com/items?itemName=inlang.vs-code-extension"
		target="_blank">Sherlock i18n extension</a
	>

	for a better i18n experience.
</p>

<h1>{m.hello_world({ name: 'SvelteKit User' })}</h1>

<div>
	<button onclick={() => setLocale('en')}>en</button>
	<button onclick={() => setLocale('es')}>es</button>
	<button onclick={() => setLocale('fr')}>fr</button>
	<button onclick={() => setLocale('it')}>it</button>
	<button onclick={() => setLocale('nl')}>nl</button>
	<button onclick={() => setLocale('pl')}>pl</button>
	<button onclick={() => setLocale('sv')}>sv</button>
	<button onclick={() => setLocale('da')}>da</button>
</div>

<p>
	If you use VSCode, install the

	<a
		href="https://marketplace.visualstudio.com/items?itemName=inlang.vs-code-extension"
		target="_blank">Sherlock i18n extension</a
	>

	for a better i18n experience.
</p>
