import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { mount, unmount } from 'svelte'
import '../../routes/layout.css'
import DomainsPage from '../../routes/projects/[slug]/domains/+page.svelte'
import type { PageData } from '../../routes/projects/[slug]/domains/$types'
import DomainMountFields from './DomainMountFields.svelte'

let component: Record<string, unknown>
let target: HTMLElement

afterEach(() => {
	unmount(component)
	target.remove()
})

it('submits legacy defaults and explicit subpath forwarding choices', async () => {
	const form = document.createElement('form')
	target = form
	form.style.maxWidth = '34rem'
	form.style.margin = '2rem auto'
	document.body.appendChild(form)
	component = mount(DomainMountFields, { target: form })
	expect(new FormData(form).get('pathPrefix')).toBe('/')
	expect(new FormData(form).get('forwardingMode')).toBe('preserve')
	await page.getByRole('textbox', { name: 'Path prefix' }).fill('/blog')
	await page.getByRole('combobox', { name: 'Forwarding mode' }).selectOptions('strip')
	expect(new FormData(form).get('pathPrefix')).toBe('/blog')
	expect(new FormData(form).get('forwardingMode')).toBe('strip')
	expect(form.textContent).toContain('authentication callbacks and cookie')
	await page.viewport(1280, 800)
	await page.screenshot({ path: '/private/tmp/risved-domain-mount-fields.png' })
})

it('shows existing mount settings and exposes the controls in the domain page', async () => {
	target = document.createElement('main')
	document.body.appendChild(target)
	const data = {
		project: { id: 'blog', name: 'Blogomat', slug: 'blogomat', port: 3002 },
		domains: [
			{
				id: 'mount',
				hostname: 'onui.com',
				pathPrefix: '/blog',
				forwardingMode: 'strip',
				isPrimary: true,
				sslStatus: 'active',
				verifiedAt: null,
				createdAt: '2026-10-16'
			}
		],
		serverIps: { ipv4: '192.0.2.1', ipv6: null },
		defaultSubdomain: 'blogomat.example.test'
	} as PageData
	component = mount(DomainsPage, { target, props: { data, form: null } })
	await expect.element(page.getByText('onui.com/blog', { exact: true })).toBeVisible()
	await expect.element(page.getByText('strip prefix', { exact: true })).toBeVisible()
	await page.getByRole('button', { name: 'Add domain', exact: true }).click()
	await page.getByRole('textbox', { name: 'Path prefix' }).fill('/blog')
	await expect.element(page.getByRole('combobox', { name: 'Forwarding mode' })).toBeVisible()
	await page.viewport(1280, 1000)
	await page.screenshot({ path: '/private/tmp/risved-domain-page-desktop.png' })
	await page.viewport(390, 844)
	expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
	await page.screenshot({ path: '/private/tmp/risved-domain-page-mobile.png' })
	await page.viewport(1280, 800)
})
