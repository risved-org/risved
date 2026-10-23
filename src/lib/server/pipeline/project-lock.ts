const projectWork = new Map<string, Promise<unknown>>()

/** Serialize builds and rollbacks sharing a project's containers, ports and routes. */
export function withProjectLock<T>(projectId: string, run: () => Promise<T>): Promise<T> {
	const previous = projectWork.get(projectId)
	const result = (previous ?? Promise.resolve()).catch(() => {}).then(run)
	projectWork.set(projectId, result)
	const release = () => {
		if (projectWork.get(projectId) === result) projectWork.delete(projectId)
	}
	result.then(release, release)
	return result
}
