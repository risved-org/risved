/** Quote generated filesystem paths without allowing shell expansion. */
export function quoteShell(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`
}
