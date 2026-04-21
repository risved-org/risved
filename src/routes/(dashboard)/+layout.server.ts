import { execSync } from 'node:child_process'
import os from 'node:os'
import type { LayoutServerLoad } from './$types'

/** Reads system health metrics from OS APIs and shell commands */
export function _getSystemHealth() {
	const cpus = os.cpus()
	const cpuUsage =
		cpus.length > 0
			? Math.round(
					cpus.reduce((acc, cpu) => {
						const total = Object.values(cpu.times).reduce((a, b) => a + b, 0)
						return acc + ((total - cpu.times.idle) / total) * 100
					}, 0) / cpus.length
				)
			: 0

	const totalMem = os.totalmem()
	const freeMem = os.freemem()
	const memoryPercent = Math.round(((totalMem - freeMem) / totalMem) * 100)

	let diskPercent = 0
	try {
		const dfOutput = execSync('df -h / | tail -1', { encoding: 'utf8' })
		const match = dfOutput.match(/(\d+)%/)
		if (match) diskPercent = parseInt(match[1], 10)
	} catch {
		/* disk info unavailable */
	}

	let uptimeStr = ''
	try {
		const uptimeSeconds = os.uptime()
		const days = Math.floor(uptimeSeconds / 86400)
		const hours = Math.floor((uptimeSeconds % 86400) / 3600)
		if (days > 0) uptimeStr = `${days}d ${hours}h`
		else uptimeStr = `${hours}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`
	} catch {
		uptimeStr = '—'
	}

	let containerCount = 0
	try {
		const output = execSync('docker ps -q 2>/dev/null | wc -l', { encoding: 'utf8' })
		containerCount = parseInt(output.trim(), 10) || 0
	} catch {
		/* docker not available */
	}

	return { cpuPercent: cpuUsage, memoryPercent, diskPercent, uptime: uptimeStr, containerCount }
}

export const load: LayoutServerLoad = async () => {
	const health = _getSystemHealth()
	return { health }
}
