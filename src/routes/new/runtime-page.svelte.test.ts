import { afterEach, expect, it } from 'vitest'
import { mount, unmount } from 'svelte'
import { page } from 'vitest/browser'
import Page from './+page.svelte'
import type { PageData } from './$types'

const data: PageData = {
	updateAvailable: null,
	frameworks: [
		{ id: 'sveltekit', name: 'SvelteKit', tier: 'node' },
		{ id: 'nextjs', name: 'Next.js', tier: 'node' }
	],
	domain: 'example.com',
	connections: []
}

let target: HTMLElement
let component: ReturnType<typeof mount>

afterEach(async () => {
	await unmount(component)
	target.remove()
})

it('submits Bun from the full creation page and updates the start-command example', async () => {
	target = document.createElement('section')
	document.body.appendChild(target)
	component = mount(Page, { target, props: { data, form: null } })
	const runtime = page.getByRole('combobox', { name: /server runtime/i })
	await expect.element(runtime).toHaveValue('node')
	await runtime.selectOptions('bun')
	const form = target.querySelector('form')!
	expect(new FormData(form).get('runtime')).toBe('bun')
	await expect.element(page.getByPlaceholder('e.g. bun build/index.js')).toBeVisible()
	await page.getByRole('combobox', { name: /framework override/i }).selectOptions('nextjs')
	await expect.element(runtime).toHaveValue('node')
	expect(new FormData(form).get('runtime')).toBe('node')
})
