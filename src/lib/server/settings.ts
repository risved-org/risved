import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Retrieves a setting value by key. Returns null if not found.
 */
export async function getSetting(key: string): Promise<string | null> {
	const result = await db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, key));
	return result[0]?.value ?? null;
}

/**
 * Sets a setting value, inserting or replacing the existing row.
 */
export async function setSetting(key: string, value: string): Promise<void> {
	await db
		.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({ target: settings.key, set: { value } });
}

/**
 * Returns true if the onboarding flow has been fully completed.
 */
export async function isOnboardingComplete(): Promise<boolean> {
	const value = await getSetting('onboarding_complete');
	return value === 'true';
}

/**
 * Resolve where to resume onboarding, based on the furthest step the user has
 * completed. Each step is inferred from the setting it writes on completion, so
 * a user bounced back into onboarding lands on the next unfinished step rather
 * than always restarting at the domain step:
 *   - DNS verified (verify done, via Continue or Skip) → Git
 *   - domain configured (domain done)                  → Verify
 *   - nothing yet                                       → Domain
 */
export async function getOnboardingResumePath(): Promise<string> {
	if ((await getSetting('dns_verified')) === 'true') return '/onboarding/git';
	if (await getSetting('domain_config')) return '/onboarding/verify';
	return '/onboarding/domain';
}
