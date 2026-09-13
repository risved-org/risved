/**
 * OAuth 2.0 protected resource metadata (RFC 9728).
 *
 * The `WWW-Authenticate` header on an unauthenticated /mcp request points
 * here; the client reads it to find which authorization server to log in with.
 */

import { oAuthProtectedResourceMetadata } from 'better-auth/plugins';
import { auth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) =>
	oAuthProtectedResourceMetadata(auth)(request);
