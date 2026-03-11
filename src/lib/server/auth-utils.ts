import { db } from '$lib/server/db';
import { user } from '$lib/server/db/auth.schema';
import { count } from 'drizzle-orm';

/**
 * Returns true if no admin user exists in the database (first-run state).
 * Used to redirect users to the onboarding flow.
 */
export async function isFirstRun(): Promise<boolean> {
	const result = await db.select({ total: count() }).from(user);
	return result[0].total === 0;
}

/**
 * Returns the total number of registered users.
 * Since this is a single-admin system, this should be 0 or 1.
 */
export async function getUserCount(): Promise<number> {
	const result = await db.select({ total: count() }).from(user);
	return result[0].total;
}
