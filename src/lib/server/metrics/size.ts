/** Multipliers for the size units Docker prints (decimal by default, binary accepted). */
const UNITS: Record<string, number> = {
	b: 1,
	kb: 1e3,
	mb: 1e6,
	gb: 1e9,
	tb: 1e12,
	pb: 1e15,
	kib: 1024,
	mib: 1024 ** 2,
	gib: 1024 ** 3,
	tib: 1024 ** 4,
	pib: 1024 ** 5
};

/**
 * Parse a human-readable Docker size such as "98.7MB", "1.88kB", "126B" or
 * "1.5GiB" into bytes. Returns 0 for anything unparseable.
 */
export function parseDockerSize(value: string): number {
	const match = value.trim().match(/^([\d.]+)\s*([a-zA-Z]+)?$/);
	if (!match) return 0;

	const amount = parseFloat(match[1]);
	if (!Number.isFinite(amount)) return 0;

	const multiplier = UNITS[(match[2] ?? 'B').toLowerCase()];
	if (!multiplier) return 0;

	return Math.round(amount * multiplier);
}
