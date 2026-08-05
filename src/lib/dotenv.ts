/**
 * Parser for pasted `.env` content.
 *
 * The env var forms accept a whole `.env` block pasted into a single row.
 * Values arrive with dotenv syntax around them — inline comments, quotes,
 * escapes — and storing that syntax verbatim produces variables that look
 * correct in the UI but break the app at runtime (an `ORIGIN` carrying a
 * trailing `# comment` is not a valid URL).
 *
 * Parsing happens at paste time, not at save time, so the cleaned value
 * lands in the field where it can be seen and corrected.
 */

export interface ParsedEnvVar {
	key: string;
	value: string;
	/** Suggested masking, from the key name. The user can always override. */
	isSecret: boolean;
}

/** Key name fragments that imply the value should be masked by default. */
const SECRET_PATTERNS = [
	'SECRET',
	'TOKEN',
	'PASSWORD',
	'PASSWD',
	'PRIVATE',
	'CREDENTIAL',
	'APIKEY',
	'API_KEY',
	'ACCESS_KEY',
	'SALT',
	'DSN',
	'DATABASE_URL',
	'DB_URL'
];

/**
 * Prefixes that mark a variable as deliberately client-exposed.
 * These are never secret, whatever else the name contains.
 */
const PUBLIC_PREFIXES = ['PUBLIC_', 'NEXT_PUBLIC_', 'VITE_', 'NUXT_PUBLIC_'];

/**
 * Guess whether a variable should be masked in the UI, from its name alone.
 * Public-prefixed names win over every secret pattern, so `PUBLIC_API_KEY`
 * stays visible.
 */
export function looksSecret(key: string): boolean {
	const upper = key.trim().toUpperCase();
	if (!upper) return false;
	if (PUBLIC_PREFIXES.some((prefix) => upper.startsWith(prefix))) return false;
	return SECRET_PATTERNS.some((pattern) => upper.includes(pattern));
}

/**
 * Parse the right-hand side of a `KEY=value` line into the value the app
 * should actually receive.
 *
 * Follows dotenv semantics:
 * - A double-quoted value is taken literally, with `\n`, `\r`, `\t`, `\\`
 *   and `\"` unescaped. `#` inside the quotes is part of the value.
 * - A single-quoted value is taken literally with no unescaping.
 * - An unquoted value ends at the first `#` that follows whitespace, so
 *   `pa#ss` and `https://host/path#frag` survive but `value # comment`
 *   loses the comment.
 *
 * An unterminated quote is treated as unquoted rather than guessed at, so
 * the stray quote stays visible in the field instead of being swallowed.
 */
export function parseDotenvValue(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return '';

	const quote = trimmed[0];
	if (quote === '"' || quote === "'") {
		const closing = findClosingQuote(trimmed, quote);
		if (closing !== -1) {
			const inner = trimmed.slice(1, closing);
			return quote === '"' ? unescapeDoubleQuoted(inner) : inner;
		}
	}

	return stripInlineComment(trimmed).trim();
}

/**
 * Parse a pasted `.env` block into rows.
 *
 * Blank lines and whole-line comments are dropped. A leading `export ` is
 * ignored. A line with no `=` becomes a key with an empty value, so a
 * pasted list of names still populates the form.
 */
export function parseDotenv(text: string): ParsedEnvVar[] {
	const rows: ParsedEnvVar[] = [];

	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
		const eqIndex = withoutExport.indexOf('=');

		if (eqIndex === -1) {
			const key = withoutExport;
			rows.push({ key, value: '', isSecret: looksSecret(key) });
			continue;
		}

		const key = withoutExport.slice(0, eqIndex).trim();
		rows.push({
			key,
			value: parseDotenvValue(withoutExport.slice(eqIndex + 1)),
			isSecret: looksSecret(key)
		});
	}

	return rows;
}

/** Index of the closing quote, skipping `\"` escapes. -1 when unterminated. */
function findClosingQuote(value: string, quote: string): number {
	for (let i = 1; i < value.length; i++) {
		if (value[i] === '\\') {
			i++;
			continue;
		}
		if (value[i] === quote) return i;
	}
	return -1;
}

/** Cut an unquoted value at a `#` that starts a comment. */
function stripInlineComment(value: string): string {
	for (let i = 0; i < value.length; i++) {
		if (value[i] !== '#') continue;
		/* Only whitespace-preceded `#` opens a comment; `pa#ss` is a value. */
		if (i === 0 || /\s/.test(value[i - 1])) return value.slice(0, i);
	}
	return value;
}

function unescapeDoubleQuoted(value: string): string {
	return value.replace(/\\([nrt\\"'])/g, (_, char: string) => {
		switch (char) {
			case 'n':
				return '\n';
			case 'r':
				return '\r';
			case 't':
				return '\t';
			default:
				return char;
		}
	});
}
