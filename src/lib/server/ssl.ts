import { connect } from 'node:tls'

export type DomainSslStatus = 'pending' | 'provisioning' | 'active'

/**
 * Checks whether a hostname presents a trusted certificate for HTTPS.
 */
export function hasValidCertificate(hostname: string, timeoutMs = 5000): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false

		const socket = connect({
			host: hostname,
			port: 443,
			servername: hostname,
			rejectUnauthorized: true
		})

		const timeout = setTimeout(() => settle(false), timeoutMs)

		const settle = (result: boolean) => {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			socket.destroy()
			resolve(result)
		}

		socket.once('secureConnect', () => settle(socket.authorized))
		socket.once('error', () => settle(false))
		socket.once('timeout', () => settle(false))
	})
}

/**
 * Resolves the stored SSL state from DNS and the live TLS certificate.
 */
export async function resolveSslStatus(hostname: string, dnsResolved: boolean): Promise<DomainSslStatus> {
	if (!dnsResolved) return 'pending'

	const validCertificate = await hasValidCertificate(hostname)
	return validCertificate ? 'active' : 'provisioning'
}
