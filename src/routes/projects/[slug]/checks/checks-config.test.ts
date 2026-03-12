import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db', () => {
	const limitMock = vi.fn().mockResolvedValue([]);
	const whereMock = vi.fn(() => ({ limit: limitMock }));
	const fromMock = vi.fn(() => ({ where: whereMock }));
	const selectMock = vi.fn(() => ({ from: fromMock }));
	const setMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
	const updateMock = vi.fn(() => ({ set: setMock }));
	return {
		db: {
			select: selectMock,
			update: updateMock,
			__limitMock: limitMock,
			__whereMock: whereMock,
			__setMock: setMock
		}
	};
});

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn')
}));

vi.mock('$lib/server/db/schema', () => ({
	projects: 'projects_table'
}));

vi.mock('$lib/server/settings', () => ({
	getSetting: vi.fn().mockResolvedValue('risved.example.com')
}));

import { db } from '$lib/server/db';
import { load, actions } from './+page.server';

const dbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

const mockProject = {
	id: 'proj-1',
	name: 'My App',
	slug: 'my-app',
	previewsEnabled: true,
	previewLimit: 3,
	previewAutoDelete: true,
	commitStatusEnabled: false,
	requiredCheck: false
};

describe('checks config load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbAny.__limitMock.mockResolvedValue([]);
	});

	it('throws 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([]);

		await expect(
			load({ params: { slug: 'nonexistent' } } as Parameters<typeof load>[0])
		).rejects.toMatchObject({ status: 404 });
	});

	it('returns project checks config and preview URL format', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([mockProject]);

		const result = (await load({
			params: { slug: 'my-app' }
		} as Parameters<typeof load>[0])) as {
			project: { commitStatusEnabled: boolean; requiredCheck: boolean };
			previewUrlFormat: string;
			risvedDomain: string;
		};
		expect(result.project.commitStatusEnabled).toBe(false);
		expect(result.project.requiredCheck).toBe(false);
		expect(result.previewUrlFormat).toBe('pr-{number}.my-app.risved.example.com');
		expect(result.risvedDomain).toBe('risved.example.com');
	});

	it('returns all preview toggle fields', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([mockProject]);

		const result = (await load({
			params: { slug: 'my-app' }
		} as Parameters<typeof load>[0])) as {
			project: {
				previewsEnabled: boolean;
				previewAutoDelete: boolean;
				previewLimit: number;
			};
		};
		expect(result.project.previewsEnabled).toBe(true);
		expect(result.project.previewAutoDelete).toBe(true);
		expect(result.project.previewLimit).toBe(3);
	});
});

describe('checks config save action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbAny.__limitMock.mockResolvedValue([]);
	});

	it('returns 404 when project not found', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([]);

		const formData = new FormData();
		const result = await actions.save({
			params: { slug: 'nonexistent' },
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.save>[0]);
		expect(result).toMatchObject({ status: 404 });
	});

	it('saves all toggle settings', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1' }]);

		const formData = new FormData();
		formData.set('previewsEnabled', 'on');
		formData.set('previewAutoDelete', 'on');
		formData.set('commitStatusEnabled', 'on');
		formData.set('requiredCheck', 'on');
		formData.set('previewLimit', '5');

		const result = await actions.save({
			params: { slug: 'my-app' },
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.save>[0]);
		expect(result).toMatchObject({ saved: true });
		expect(db.update).toHaveBeenCalled();
	});

	it('defaults previewLimit to 3 when invalid', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1' }]);

		const formData = new FormData();
		formData.set('previewLimit', 'abc');

		const result = await actions.save({
			params: { slug: 'my-app' },
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.save>[0]);
		expect(result).toMatchObject({ saved: true });

		const setCall = dbAny.__setMock.mock.calls[0][0];
		expect(setCall.previewLimit).toBe(3);
	});

	it('handles unchecked toggles as false', async () => {
		dbAny.__limitMock.mockResolvedValueOnce([{ id: 'proj-1' }]);

		const formData = new FormData();
		formData.set('previewLimit', '2');

		const result = await actions.save({
			params: { slug: 'my-app' },
			request: { formData: () => Promise.resolve(formData) }
		} as unknown as Parameters<typeof actions.save>[0]);
		expect(result).toMatchObject({ saved: true });

		const setCall = dbAny.__setMock.mock.calls[0][0];
		expect(setCall.previewsEnabled).toBe(false);
		expect(setCall.commitStatusEnabled).toBe(false);
		expect(setCall.requiredCheck).toBe(false);
		expect(setCall.previewAutoDelete).toBe(false);
	});
});

describe('checks config page source', () => {
	it('has status check mock section', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('status-check-mock');
		expect(mod.default).toContain('risved/deploy-preview');
		expect(mod.default).toContain('risved/build');
	});

	it('has preview URL format section', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('url-format-section');
		expect(mod.default).toContain('preview-url-format');
	});

	it('has all four toggle settings', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('toggle-commit-status');
		expect(mod.default).toContain('toggle-previews');
		expect(mod.default).toContain('toggle-auto-delete');
		expect(mod.default).toContain('toggle-required-check');
	});

	it('has preview limit input', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('preview-limit-input');
	});

	it('has save button', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('save-btn');
		expect(mod.default).toContain('Save settings');
	});

	it('uses enhance for the form', async () => {
		const mod = await import('./+page.svelte?raw');
		expect(mod.default).toContain('use:enhance');
	});
});
