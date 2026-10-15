import { afterEach, expect, it } from 'vitest'
import { mount, unmount } from 'svelte'
import { page } from 'vitest/browser'
import ProjectRuntimeField from './ProjectRuntimeField.svelte'

let target: HTMLFormElement
let component: ReturnType<typeof mount>

/** Render the field in a form to check its submitted value. */
function render(frameworkId = 'sveltekit', tier = 'node') {
	target = document.createElement('form')
	document.body.appendChild(target)
	component = mount(ProjectRuntimeField, { target, props: { frameworkId, tier, settings: true } })
}

afterEach(async () => {
	await unmount(component)
	target.remove()
})

it('defaults to Node, submits Bun, and allows switching back', async () => {
	render()
	const runtime = page.getByRole('combobox', { name: /server runtime/i })
	await expect.element(runtime).toHaveValue('node')
	await runtime.selectOptions('bun')
	expect(new FormData(target).get('runtime')).toBe('bun')
	await expect.element(page.getByText(/next deployment/)).toBeVisible()
	await runtime.selectOptions('node')
	expect(new FormData(target).get('runtime')).toBe('node')
})

it('disables Bun for unsupported frameworks', async () => {
	render('nextjs')
	await expect.element(page.getByRole('option', { name: /Bun/ })).toBeDisabled()
})
