import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/paraglide/runtime', () => ({
	deLocalizeUrl: vi.fn((url: URL) => new URL(url.toString().replace('/en', '')))
}));

import { reroute } from './hooks';
import { deLocalizeUrl } from '$lib/paraglide/runtime';

describe('reroute', () => {
	it('returns the pathname of the de-localized URL', () => {
		const url = new URL('https://example.com/en/dashboard');
		const result = reroute({ url });

		expect(deLocalizeUrl).toHaveBeenCalledWith(url);
		expect(result).toBe('/dashboard');
	});
});
