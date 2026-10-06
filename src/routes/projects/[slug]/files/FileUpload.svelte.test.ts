import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, unmount, tick } from 'svelte'
import { stringify } from 'devalue'
import { page } from 'vitest/browser'
import FileUpload from './FileUpload.svelte'
import '../../../layout.css'

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn().mockResolvedValue(undefined) }))

/* Standalone components have no SvelteKit router to initialize action decoders. */
vi.mock('$app/forms', async () => {
	const { parse } = await import('devalue')
	return {
		deserialize: (text: string) => {
			const result = JSON.parse(text)
			if (result.data) result.data = parse(result.data)
			return result
		}
	}
})

let target: HTMLElement
let component: ReturnType<typeof mount>
let requests: FormData[]

/** Render the real form so selection, progress, retries and confirmation run in Chromium. */
function render(replacing = false) {
	target = document.createElement('section')
	target.style.cssText = 'max-width: 40rem; margin: 1rem auto; padding: 0 1rem'
	document.body.appendChild(target)
	component = mount(FileUpload, {
		target,
		props: {
			path: replacing ? 'private/bank.key' : '',
			directory: 'fonts',
			replacing,
			onclose: vi.fn()
		}
	})
}

/** Use the same serialized action response shape returned by SvelteKit. */
function response(status = 200) {
	return new Response(
		JSON.stringify({
			type: status === 200 ? 'success' : 'failure',
			status,
			data: stringify(status === 200 ? { success: 'Saved' } : { error: 'Storage unavailable' })
		})
	)
}

/** Populate the native file input and dispatch its normal event. */
async function select(files: File[]) {
	const transfer = new DataTransfer()
	for (const file of files) transfer.items.add(file)
	const input = target.querySelector<HTMLInputElement>('input[type="file"]')!
	input.files = transfer.files
	input.dispatchEvent(new Event('input', { bubbles: true }))
	await tick()
}

/** Find an action by its visible label instead of depending on DOM order. */
function button(label: string) {
	const found = [...target.querySelectorAll('button')].find(
		button => button.textContent?.trim() === label
	)
	if (!found) throw new Error(`Missing button: ${label}`)
	return found
}

/** Wait for the entire batch and reactive DOM update to complete. */
async function finish() {
	await tick()
	await vi.waitFor(() =>
		expect(target.querySelector('form')?.getAttribute('aria-busy')).toBe('false')
	)
	await tick()
}

/** Read rendered copy without formatting whitespace from the component source. */
function text() {
	return target.textContent?.replace(/\s+/g, ' ')
}

beforeEach(() => {
	requests = []
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
		requests.push(options!.body as FormData)
		return response()
	})
})

afterEach(() => {
	if (component) unmount(component)
	target?.remove()
	vi.restoreAllMocks()
})

describe('multi-file uploads', () => {
	it('keeps conflict results and confirmation readable on desktop and mobile', async () => {
		vi.mocked(fetch).mockImplementation(async (_url, options) => {
			requests.push(options!.body as FormData)
			return response(requests.length === 1 ? 409 : 200)
		})
		render()
		await select([
			new File(['font'], 'Europa-Regular.woff2'),
			new File(['font'], 'Europa-Bold.woff2')
		])
		button('Upload 2 files').click()
		await finish()
		button('Replace').click()
		await tick()
		await page.viewport(1280, 800)
		await page.screenshot({ path: 'test-results/risved-multi-upload-desktop.png' })
		await page.viewport(390, 844)
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
		await page.screenshot({ path: 'test-results/risved-multi-upload-mobile.png' })
		expect(button('Replace file').disabled).toBe(false)
		await page.viewport(1280, 800)
	})
	it('uploads a selection larger than 10 MiB as separate requests with original filenames', async () => {
		render()
		await select([
			new File([new Uint8Array(6 * 1024 * 1024)], 'Regular.woff2'),
			new File([new Uint8Array(6 * 1024 * 1024)], 'Éuropa Bold.woff2')
		])
		expect(target.querySelector<HTMLInputElement>('input[type="file"]')!.multiple).toBe(true)
		button('Upload 2 files').click()
		await finish()
		expect(requests.map(form => form.get('path'))).toEqual([
			'fonts/Regular.woff2',
			'fonts/Éuropa Bold.woff2'
		])
		expect(requests.every(form => form.getAll('file').length === 1 && !form.has('replace'))).toBe(
			true
		)
		expect(text()).toContain('2 of 2 files uploaded.')
		expect(button('Done')).toBeDefined()
	})
	it('continues after a failure and retries only the failed file at its original destination', async () => {
		vi.mocked(fetch).mockImplementation(async (_url, options) => {
			requests.push(options!.body as FormData)
			return response(requests.length === 1 ? 503 : 200)
		})
		render()
		await select([new File(['a'], 'a.woff2'), new File(['b'], 'b.woff2')])
		button('Upload 2 files').click()
		await finish()
		expect(text()).toContain('1 of 2 files uploaded.')
		expect(target.querySelector<HTMLInputElement>('input[name="path"]')!.readOnly).toBe(true)
		button('Retry failed uploads').click()
		await finish()
		expect(requests.map(form => form.get('path'))).toEqual([
			'fonts/a.woff2',
			'fonts/b.woff2',
			'fonts/a.woff2'
		])
		expect(text()).toContain('2 of 2 files uploaded.')
	})
	it('continues after a conflict and replaces only after explicit confirmation', async () => {
		vi.mocked(fetch).mockImplementation(async (_url, options) => {
			requests.push(options!.body as FormData)
			return response(requests.length === 1 ? 409 : 200)
		})
		render()
		await select([new File(['a'], 'existing.woff2'), new File(['b'], 'new.woff2')])
		button('Upload 2 files').click()
		await finish()
		button('Replace').click()
		await tick()
		expect(requests).toHaveLength(2)
		expect(text()).toContain('The existing file will be overwritten.')
		button('Replace file').click()
		await finish()
		expect(requests[2].get('replace')).toBe('yes')
		expect(requests[2].get('path')).toBe('fonts/existing.woff2')
		expect(text()).toContain('2 of 2 files uploaded.')
	})
	it('rejects oversized files individually while uploading valid files', async () => {
		render()
		await select([
			new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.woff2'),
			new File(['ok'], 'small.woff2')
		])
		button('Upload 2 files').click()
		await finish()
		expect(requests.map(form => form.get('path'))).toEqual(['fonts/small.woff2'])
		expect(text()).toContain('Choose a file no larger than 10 MiB.')
		expect(text()).toContain('1 of 2 files uploaded.')
	})
	it('keeps replacement to one file and uses the existing path', async () => {
		render(true)
		await select([new File(['new key'], 'different-name.key')])
		expect(target.querySelector<HTMLInputElement>('input[type="file"]')!.multiple).toBe(false)
		button('Replace file').click()
		await finish()
		expect(requests[0].get('path')).toBe('private/bank.key')
		expect(requests[0].get('replace')).toBe('yes')
	})
	it('continues after a network error and allows an individual retry', async () => {
		vi.mocked(fetch).mockImplementation(async (_url, options) => {
			requests.push(options!.body as FormData)
			if (requests.length === 1) throw new TypeError('Network error')
			return response()
		})
		render()
		await select([new File(['a'], 'a'), new File(['b'], 'b')])
		button('Upload 2 files').click()
		await finish()
		expect(text()).toContain('Check your connection and retry.')
		button('Retry').click()
		await finish()
		expect(requests.map(form => form.get('path'))).toEqual(['fonts/a', 'fonts/b', 'fonts/a'])
	})
	it('allows the volume root and rejects unsafe shared folders before sending files', async () => {
		render()
		await select([new File(['a'], 'a')])
		const folder = target.querySelector<HTMLInputElement>('input[name="path"]')!
		folder.value = '../escape'
		folder.dispatchEvent(new Event('input', { bubbles: true }))
		await tick()
		button('Upload 1 file').click()
		await finish()
		expect(requests).toHaveLength(0)
		folder.value = ''
		folder.dispatchEvent(new Event('input', { bubbles: true }))
		await tick()
		button('Upload 1 file').click()
		await finish()
		expect(requests[0].get('path')).toBe('a')
	})
})
