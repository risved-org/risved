import { getSetting, setSetting } from '$lib/server/settings'
import { createRequire } from 'node:module'

const CENSUS_URL = 'https://risved.com/api/census'
const INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * CensusReporter sends a minimal daily ping to risved.com
 * containing only: instance UUID, version, and timestamp.
 */
export class CensusReporter {
	private timer: ReturnType<typeof setInterval> | null = null
	private censusUrl: string

	constructor(config: { censusUrl?: string } = {}) {
		this.censusUrl = config.censusUrl ?? CENSUS_URL
	}

	start(): void {
		if (this.timer) return
		console.log('[census] Census reporting is enabled, sending to risved.com daily')
		this.timer = setInterval(() => this.ping(), INTERVAL_MS)
		/* Run initial ping after 15 seconds to let the DB settle */
		setTimeout(() => this.ping(), 15_000)
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer)
			this.timer = null
		}
	}

	isRunning(): boolean {
		return this.timer !== null
	}

	/** Get or create the instance UUID. Persists in the settings table. */
	async getInstanceId(): Promise<string> {
		const existing = await getSetting('census_instance_id')
		if (existing) return existing

		const id = crypto.randomUUID()
		await setSetting('census_instance_id', id)
		return id
	}

	/** Read the current version from package.json. */
	getVersion(): string {
		try {
			const require = createRequire(import.meta.url)
			const pkg = require('../../../../package.json')
			return pkg.version || '0.0.1'
		} catch {
			return '0.0.1'
		}
	}

	/** Build the census payload. */
	async buildPayload(): Promise<{ instance_id: string; version: string; timestamp: string }> {
		const instanceId = await this.getInstanceId()
		const version = this.getVersion()
		const timestamp = new Date().toISOString()

		return {
			instance_id: instanceId,
			version,
			timestamp
		}
	}

	/** Send the census ping. Silently swallows errors. */
	async ping(): Promise<boolean> {
		try {
			const payload = await this.buildPayload()

			const res = await fetch(this.censusUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(10_000)
			})

			await setSetting('census_last_ping', payload.timestamp)
			return res.ok
		} catch {
			/* Census failures are silent — never block the control plane */
			return false
		}
	}

	/** Get census info for the settings page. */
	async getInfo(): Promise<{
		instanceId: string
		version: string
		lastPing: string | null
	}> {
		const instanceId = await this.getInstanceId()
		const version = this.getVersion()
		const lastPing = await getSetting('census_last_ping')

		return { instanceId, version, lastPing }
	}
}

/* Singleton */
let instance: CensusReporter | null = null

export function getCensusReporter(config?: { censusUrl?: string }): CensusReporter {
	if (!instance) {
		instance = new CensusReporter(config)
	}
	return instance
}
