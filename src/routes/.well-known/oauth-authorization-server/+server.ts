/**
 * OAuth 2.1 authorization server metadata (RFC 8414).
 *
 * MCP clients fetch this to discover the authorization, token and dynamic
 * client registration endpoints before starting the login flow. Public by
 * design — it is discovery, not data.
 */

import { oAuthDiscoveryMetadata } from 'better-auth/plugins';
import { auth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => oAuthDiscoveryMetadata(auth)(request);
