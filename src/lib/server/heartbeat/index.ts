import { db } from '$lib/server/db'
import { projects, deployments } from '$lib/server/db/schema'
import { desc, eq, count } from 'drizzle-orm'
import { getSetting, setSetting } from '$lib/server/settings'
import { getCensusReporter } from '$lib/server/census'
import { createHmac } from 'node:crypto'

const HEARTBEAT_URL = 'https://risved.com/api/heartbeat'
const INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

export interface HeartbeatPayload {
	instance_id: string
	version: string
	timestamp: string
	uptime_seconds: number
	project_count: number
	last_deploy_at: string | null
	total_backup_bytes: number
	total_bandwidth_bytes_30d: number
}

/**
 * HeartbeatReporter sends operational metadata to risved.com every 5 minutes.
 * Only active when the `operational_heartbeat` setting is `true`.
 * Default is off — Cloud provisioning sets it to true.
 */
export class HeartbeatReporter {
	private timer: ReturnType<typeof setInterval> | null = null
	private startedAt: number = Date.now()
	private heartbeatUrl: string

	constructor(config: { heartbeatUrl?: string } = {}) {
		this.heartbeatUrl = config.heartbeatUrl ?? HEARTBEAT_URL
	}

	async start(): Promise<void> {
		if (this.timer) return
		this.startedAt = Date.now()

		const enabled = await this.isEnabled()
		if (!enabled) return

		console.log('[heartbeat] Operational reporting is enabled, sending to risved.com every 5 minutes')
		this.timer = setInterval(() => this.beat(), INTERVAL_MS)
		setTimeout(() => this.beat(), 20_000)
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

	async isEnabled(): Promise<boolean> {
		const setting = await getSetting('operational_heartbeat')
		return setting === 'true'
	}

	async setEnabled(enabled: boolean): Promise<void> {
		await setSetting('operational_heartbeat', enabled ? 'true' : 'false')
		if (enabled && !this.timer) {
			console.log('[heartbeat] Operational reporting enabled')
			this.timer = setInterval(() => this.beat(), INTERVAL_MS)
			setTimeout(() => this.beat(), 5_000)
		} else if (!enabled && this.timer) {
			console.log('[heartbeat] Operational reporting disabled')
			clearInterval(this.timer)
			this.timer = null
		}
	}

	/** Get or create the signing secret for HMAC authentication. */
	async getSigningSecret(): Promise<string> {
		const existing = await getSetting('heartbeat_signing_secret')
		if (existing) return existing

		const bytes = new Uint8Array(32)
		crypto.getRandomValues(bytes)
		const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
		await setSetting('heartbeat_signing_secret', secret)
		return secret
	}

	/** Sign a payload with HMAC-SHA256. */
	async sign(payload: string): Promise<string> {
		const secret = await this.getSigningSecret()
		return createHmac('sha256', secret).update(payload).digest('hex')
	}

	/** Build the heartbeat payload. */
	async buildPayload(): Promise<HeartbeatPayload> {
		const census = getCensusReporter()
		const instanceId = await census.getInstanceId()
		const version = census.getVersion()
		const timestamp = new Date().toISOString()
		const uptimeSeconds = Math.floor((Date.now() - this.startedAt) / 1000)

		const [projectCountResult] = await db
			.select({ value: count() })
			.from(projects)

		const latestDeploy = await db
			.select({ finishedAt: deployments.finishedAt })
			.from(deployments)
			.where(eq(deployments.status, 'live'))
			.orderBy(desc(deployments.createdAt))
			.limit(1)

		const lastDeployAt = latestDeploy[0]?.finishedAt ?? null

		return {
			instance_id: instanceId,
			version,
			timestamp,
			uptime_seconds: uptimeSeconds,
			project_count: projectCountResult.value,
			last_deploy_at: lastDeployAt,
			total_backup_bytes: 0,
			total_bandwidth_bytes_30d: 0
		}
	}

	/** Send the heartbeat. Silently swallows errors. */
	async beat(): Promise<boolean> {
		try {
			const enabled = await this.isEnabled()
			if (!enabled) {
				this.stop()
				return false
			}

			const payload = await this.buildPayload()
			const body = JSON.stringify(payload)
			const signature = await this.sign(body)

			const res = await fetch(this.heartbeatUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Risved-Signature': signature
				},
				body,
				signal: AbortSignal.timeout(10_000)
			})

			await setSetting('heartbeat_last_ping', payload.timestamp)
			return res.ok
		} catch {
			return false
		}
	}

	/** Get heartbeat info for the settings page. */
	async getInfo(): Promise<{
		enabled: boolean
		lastPing: string | null
	}> {
		const enabled = await this.isEnabled()
		const lastPing = await getSetting('heartbeat_last_ping')
		return { enabled, lastPing }
	}
}

/* Singleton */
let instance: HeartbeatReporter | null = null

export function getHeartbeatReporter(config?: { heartbeatUrl?: string }): HeartbeatReporter {
	if (!instance) {
		instance = new HeartbeatReporter(config)
	}
	return instance
}
