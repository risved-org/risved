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
