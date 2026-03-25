export interface UpdateInfo {
	currentVersion: string
	latestVersion: string | null
	updateAvailable: boolean
	releaseNotes: string | null
	releaseUrl: string | null
	checkedAt: string | null
	error: string | null
}

export interface VersionManifest {
	version: string
	releaseNotes: string
	minVersion: string
}

export interface PreflightResult {
	ok: boolean
	reason?: string
}

export interface UpdateCheckerConfig {
	/** How often to check for updates (ms). Default: 1 hour */
	intervalMs: number
	/** URL to fetch the version manifest from */
	versionUrl: string
	/** Path to the Risved installation directory */
	installDir: string
}
