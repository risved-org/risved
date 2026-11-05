import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, unmount, tick } from 'svelte'
import Page from './+page.svelte'
import type { PageData } from './$types'

/**
 * Drives the real component in a browser: the repo picker's request
 * ordering and what switching accounts does to an already picked repo.
 */

function repo(id: number, name: string) {
	return {
		id,
		fullName: `acme/${name}`,
		name,
		owner: 'acme',
		private: false,
		defaultBranch: 'main',
		htmlUrl: `https://github.com/acme/${name}`,
		cloneUrl: `https://github.com/acme/${name}.git`,
		description: null,
		language: null,
		updatedAt: new Date().toISOString()
	}
}

const data: PageData = {
	updateAvailable: null,
	frameworks: [{ id: 'sveltekit', name: 'SvelteKit', tier: 'node' }],
	domain: 'example.com',
	connections: [
		{ id: 'conn-a', provider: 'github', accountName: 'account-a', avatarUrl: null },
		{ id: 'conn-b', provider: 'github', accountName: 'account-b', avatarUrl: null }
	]
}

let target: HTMLElement
let component: Record<string, unknown>

function render() {
	target = document.createElement('div')
	document.body.appendChild(target)
	component = mount(Page, { target, props: { form: null, data } })
}

function byTestId<T extends HTMLElement>(id: string): T {
	const el = target.querySelector<T>(`[data-testid="${id}"]`)
	if (!el) throw new Error(`no [data-testid="${id}"]`)
	return el
}

function hidden(name: string): HTMLInputElement | null {
	return target.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)
}

function type(input: HTMLInputElement, value: string) {
	input.value = value
	input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Let the debounce elapse and pending fetches settle */
async function settle(ms = 400) {
	await new Promise(resolve => setTimeout(resolve, ms))
	await tick()
}

describe('new project repo picker', () => {
	afterEach(() => {
		unmount(component)
		target.remove()
		vi.restoreAllMocks()
	})

	it('sends one search request per pause in typing', async () => {
		const searches: (string | null)[] = []
		vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
			const parsed = new URL(String(url), location.origin)
			searches.push(parsed.searchParams.get('search'))
			return new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } })
		})

		render()
		/* let the load that mounting triggers finish first */
		await settle()
		searches.length = 0

		const search = byTestId<HTMLInputElement>('repo-search')
		type(search, 'r')
		type(search, 're')
		type(search, 'red')
		type(search, 'redis')
		await settle()

		expect(searches).toEqual(['redis'])
	})

	it('ignores a slow response that a newer search has superseded', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
			const query = new URL(String(url), location.origin).searchParams.get('search')
			const body = query === 're' ? [repo(1, 'renamer')] : [repo(2, 'redis')]
			/* The earlier, broader search answers long after the newer one */
			await new Promise(resolve => setTimeout(resolve, query === 're' ? 600 : 10))
			return new Response(JSON.stringify(body), {
				headers: { 'content-type': 'application/json' }
			})
		})

		render()
		const search = byTestId<HTMLInputElement>('repo-search')
		type(search, 're')
		/* just past the debounce: the 're' request is in flight */
		await settle(300)
		type(search, 'redis')
		/* long enough for the 'redis' answer and then the stale 're' answer */
		await settle(700)

		const names = [...target.querySelectorAll('[data-testid="repo-row"] .repo-name')].map(el =>
			el.textContent?.trim()
		)
		expect(names).toEqual(['acme/redis'])
	})

	it('drops the picked repo when the account changes', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
			const parsed = new URL(String(url), location.origin)
			const body = parsed.pathname.includes('/repos')
				? [repo(3, 'ledger')]
				: { packageManager: 'bun', lockfile: null, warning: null, suggestions: [], empty: false }
			return new Response(JSON.stringify(body), {
				headers: { 'content-type': 'application/json' }
			})
		})

		render()
		await settle(300)
		byTestId<HTMLButtonElement>('repo-row').click()
		await settle(200)

		expect(hidden('repoUrl')?.value).toBe('https://github.com/acme/ledger.git')
		expect(hidden('connectionId')?.value).toBe('conn-a')

		const account = byTestId<HTMLSelectElement>('account-select')
		account.value = 'conn-b'
		account.dispatchEvent(new Event('change', { bubbles: true }))
		await settle(200)

		/* The clone URL of account A must not travel with account B */
		expect(hidden('connectionId')?.value).toBe('conn-b')
		expect(hidden('repoUrl')?.value).toBe('')
	})
})
