/**
 * Parser for pasted `.env` content.
 *
 * The env var forms accept a whole `.env` block pasted into a single row.
 * Values arrive with dotenv syntax around them — inline comments, quotes,
 * escapes, values spanning several lines — and storing that syntax verbatim
 * produces variables that look correct in the UI but break the app at
 * runtime (an `ORIGIN` carrying a trailing `# comment` is not a valid URL).
 *
 * Parsing happens at paste time, not at save time, so the cleaned value
 * lands in the field where it can be seen and corrected.
 *
 * Deliberately NOT supported: `${VAR}` interpolation. risved stores and
 * injects values verbatim, so expanding a reference at paste time would
 * bake in whatever the browser guessed and silently diverge from what the
 * container actually receives.
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
 * Shape the API accepts (see `/api/projects/[id]/env`). Pasted lines whose
 * key does not match are dropped rather than surfaced as rows that would
 * only fail on save — pasting a code snippet should not fill the form with
 * junk.
 */
const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const QUOTES = ['"', "'", '`'];

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
 * Parse a single-line right-hand side of `KEY=value` into the value the app
 * should actually receive.
 *
 * Follows dotenv semantics:
 * - A double-quoted or backtick-quoted value is taken literally, with `\n`,
 *   `\r`, `\t`, `\\`, `\"` and `\'` unescaped. `#` inside quotes is part of
 *   the value.
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
	if (QUOTES.includes(quote)) {
		const closing = findClosingQuote(trimmed, 0, quote);
		if (closing !== -1) {
			const inner = trimmed.slice(1, closing);
			return unescapeDollar(quote === "'" ? inner : unescapeQuoted(inner));
		}
	}

	return unescapeDollar(stripInlineComment(trimmed).trim());
}

/**
 * Parse a pasted `.env` block into rows.
 *
 * Scans the whole block rather than line by line, so a quoted value may span
 * several lines — the common case being a PEM key or a JSON credential blob
 * pasted with its real newlines intact.
 *
 * Blank lines and whole-line comments are dropped. A leading `export ` is
 * ignored. A line with no `=` becomes a key with an empty value, so a pasted
 * list of names still populates the form. A repeated key keeps its original
 * position and takes the last value, matching dotenv and avoiding rows the
 * API would reject as duplicates.
 */
export function parseDotenv(text: string): ParsedEnvVar[] {
	const source = text.replace(/^\uFEFF/, '');
	const rows: ParsedEnvVar[] = [];
	let i = 0;

	while (i < source.length) {
		/* Skip blank lines and any leading indentation. */
		while (i < source.length && /\s/.test(source[i])) i++;
		if (i >= source.length) break;

		if (source[i] === '#') {
			i = endOfLine(source, i);
			continue;
		}

		const lineEnd = endOfLine(source, i);
		const eq = source.indexOf('=', i);

		/* No `=` on this line: a bare name, with no value. */
		if (eq === -1 || eq > lineEnd) {
			addRow(rows, source.slice(i, lineEnd).trim(), '');
			i = lineEnd;
			continue;
		}

		let key = source.slice(i, eq).trim();
		if (key.startsWith('export ')) key = key.slice(7).trim();

		let cursor = eq + 1;
		while (source[cursor] === ' ' || source[cursor] === '\t') cursor++;

		const quote = source[cursor];
		if (QUOTES.includes(quote)) {
			const closing = findClosingQuote(source, cursor, quote);
			if (closing !== -1) {
				const inner = source.slice(cursor + 1, closing);
				addRow(rows, key, unescapeDollar(quote === "'" ? inner : unescapeQuoted(inner)));
				/* Anything after the closing quote is a comment. */
				i = endOfLine(source, closing);
				continue;
			}
			/* Unterminated: fall through and treat the rest of the line as a
			   plain value, leaving the stray quote visible. */
		}

		addRow(rows, key, parseDotenvValue(source.slice(cursor, lineEnd)));
		i = lineEnd;
	}

	return rows;
}

/** Append a row, dropping invalid keys and letting a repeat key win. */
function addRow(rows: ParsedEnvVar[], key: string, value: string): void {
	if (!VALID_KEY.test(key)) return;

	const existing = rows.find((row) => row.key === key);
	if (existing) {
		existing.value = value;
		return;
	}

	rows.push({ key, value, isSecret: looksSecret(key) });
}

function endOfLine(source: string, from: number): number {
	const newline = source.indexOf('\n', from);
	return newline === -1 ? source.length : newline;
}

/**
 * Index of the closing quote for the one opening at `start`, or -1 when
 * unterminated. Single quotes take no escapes, matching dotenv.
 */
function findClosingQuote(source: string, start: number, quote: string): number {
	for (let i = start + 1; i < source.length; i++) {
		if (quote !== "'" && source[i] === '\\') {
			i++;
			continue;
		}
		if (source[i] === quote) return i;
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

/**
 * Thrown when a value cannot be represented in a `.env` file. Carries the
 * offending keys so the deploy can name them instead of failing vaguely.
 */
export class DotenvEncodeError extends Error {
	readonly keys: string[];

	constructor(keys: string[], reason: string) {
		super(`Cannot write ${keys.join(', ')} to the build .env: ${reason}`);
		this.name = 'DotenvEncodeError';
		this.keys = keys;
	}
}

/**
 * Wrap a value so a dotenv parser reads back exactly what went in.
 *
 * Two things drive this, both established by round-tripping values through
 * Vite's own loader (see dotenv.test.ts):
 *
 * - Quoted values are taken literally, so the wrapper must be a character
 *   the value does not contain. Single quotes first, then backtick, then
 *   double. Escaping the wrapper instead does not work: dotenv consumes
 *   `\"` without unescaping it, which is how risved's previous writer
 *   turned `say "hi"` into `say \"hi\"`.
 * - `$` is expanded, in every quoting style. `${OTHER}` picks up a sibling
 *   variable and a `${MISSING}` collapses to nothing, so every `$` is
 *   escaped as `\$` — which the expander honours and strips back.
 */
export function encodeDotenvValue(value: string): string {
	const escaped = value.replace(/\$/g, '\\$');
	const quote = ["'", '`', '"'].find((candidate) => !value.includes(candidate));

	if (quote === undefined) {
		throw new DotenvEncodeError([], 'it contains every quote character');
	}

	return quote + escaped + quote;
}

/**
 * Render env vars as a `.env` file for the build stage.
 *
 * Self-checking: every value is parsed back out of the rendered file and
 * compared, so an encoding gap fails the deploy with the offending variable
 * named rather than silently shipping a corrupted secret into the build.
 */
export function serializeDotenv(env: Record<string, string>): string {
	const entries = Object.entries(env);

	/* A carriage return is dropped by every dotenv parser, in every quoting
	   style. There is no encoding that survives it, so refuse rather than
	   corrupt — it is almost always an accident from a Windows paste. */
	const withCarriageReturn = entries.filter(([, value]) => value.includes('\r')).map(([key]) => key);
	if (withCarriageReturn.length > 0) {
		throw new DotenvEncodeError(
			withCarriageReturn,
			'the value contains a carriage return, which no dotenv parser preserves. Remove the CR characters and redeploy.'
		);
	}

	const unencodable: string[] = [];
	const lines: string[] = [];
	for (const [key, value] of entries) {
		try {
			lines.push(`${key}=${encodeDotenvValue(value)}`);
		} catch {
			unencodable.push(key);
		}
	}
	if (unencodable.length > 0) {
		throw new DotenvEncodeError(unencodable, 'the value contains every quote character');
	}

	const file = lines.join('\n');

	/* Prove the round-trip rather than trusting it. */
	const readBack = new Map(parseDotenv(file).map((row) => [row.key, row.value]));
	const corrupted = entries
		.filter(([key, value]) => readBack.get(key) !== value)
		.map(([key]) => key);
	if (corrupted.length > 0) {
		throw new DotenvEncodeError(corrupted, 'the value did not survive a round-trip through dotenv');
	}

	return file;
}

/**
 * Undo `\$`. Dotenv parsers hand their result to an expander that resolves
 * `${VAR}` and treats a backslash as the opt-out, so this runs after the
 * quote handling, in every quoting style.
 */
function unescapeDollar(value: string): string {
	return value.replace(/\\\$/g, '$');
}

function unescapeQuoted(value: string): string {
	return value.replace(/\\([nrt\\"'`])/g, (_, char: string) => {
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
