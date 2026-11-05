type Access = 'deployment' | 'prune'
type Waiter = { access: Access; resolve: () => void }

const queue: Waiter[] = []
let deployments = 0
let pruning = false

/** Grant concurrent deployments or one exclusive prune, in arrival order. */
function drain(): void {
	if (pruning) return
	while (queue.length > 0) {
		const next = queue[0]
		if (next.access === 'prune') {
			if (deployments > 0) return
			pruning = true
			queue.shift()
			next.resolve()
			return
		}
		deployments++
		queue.shift()
		next.resolve()
	}
}

/** Hold access until the entire operation settles, including failure cleanup. */
async function withAccess<T>(access: Access, operation: () => Promise<T>): Promise<T> {
	await new Promise<void>((resolve) => {
		queue.push({ access, resolve })
		drain()
	})
	try {
		return await operation()
	} finally {
		if (access === 'prune') pruning = false
		else deployments--
		drain()
	}
}

/** Protect a build, preview or rollback from manual Docker pruning. */
export function withDeploymentResources<T>(operation: () => Promise<T>): Promise<T> {
	return withAccess('deployment', operation)
}

/** Wait for deployments to finish and block new ones until pruning completes. */
export function withDockerPrune<T>(operation: () => Promise<T>): Promise<T> {
	return withAccess('prune', operation)
}
