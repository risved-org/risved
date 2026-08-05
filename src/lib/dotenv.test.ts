import { describe, it, expect } from 'vitest';
import { parseDotenv, parseDotenvValue, looksSecret } from './dotenv';

describe('parseDotenvValue', () => {
	it('returns a plain value unchanged', () => {
		expect(parseDotenvValue('https://workshopeuropa.com')).toBe('https://workshopeuropa.com');
	});

	it('strips a trailing inline comment', () => {
		expect(parseDotenvValue('https://workshopeuropa.com   # required by adapter-node')).toBe(
			'https://workshopeuropa.com'
		);
	});

	it('strips an inline comment from a numeric value', () => {
		expect(parseDotenvValue('3000            # container port')).toBe('3000');
	});

	it('keeps a # that is not preceded by whitespace', () => {
		expect(parseDotenvValue('postgres://user:pa#ss@host/db')).toBe('postgres://user:pa#ss@host/db');
	});

	it('keeps a URL fragment', () => {
		expect(parseDotenvValue('https://host/path#section')).toBe('https://host/path#section');
	});

	it('trims surrounding whitespace', () => {
		expect(parseDotenvValue('   spaced   ')).toBe('spaced');
	});

	it('returns empty string for an empty value', () => {
		expect(parseDotenvValue('')).toBe('');
	});

	it('returns empty string for a whitespace-only value', () => {
		expect(parseDotenvValue('    ')).toBe('');
	});

	it('strips double quotes', () => {
		expect(parseDotenvValue('"quoted value"')).toBe('quoted value');
	});

	it('strips single quotes', () => {
		expect(parseDotenvValue("'quoted value'")).toBe('quoted value');
	});

	it('keeps a # inside double quotes', () => {
		expect(parseDotenvValue('"value # not a comment"')).toBe('value # not a comment');
	});

	it('keeps a # inside single quotes', () => {
		expect(parseDotenvValue("'value # not a comment'")).toBe('value # not a comment');
	});

	it('unescapes newlines inside double quotes', () => {
		expect(parseDotenvValue('"line1\\nline2"')).toBe('line1\nline2');
	});

	it('unescapes tabs, carriage returns and backslashes inside double quotes', () => {
		expect(parseDotenvValue('"a\\tb\\rc\\\\d"')).toBe('a\tb\rc\\d');
	});

	it('unescapes an escaped double quote', () => {
		expect(parseDotenvValue('"say \\"hi\\""')).toBe('say "hi"');
	});

	it('does not unescape inside single quotes', () => {
		expect(parseDotenvValue("'no\\nescape'")).toBe('no\\nescape');
	});

	it('drops a comment following a quoted value', () => {
		expect(parseDotenvValue('"quoted"   # trailing note')).toBe('quoted');
	});

	it('treats an unterminated quote as an unquoted value', () => {
		expect(parseDotenvValue('"unterminated')).toBe('"unterminated');
	});
});

describe('parseDotenv', () => {
	it('parses a single line', () => {
		expect(parseDotenv('ORIGIN=https://example.com')).toEqual([
			{ key: 'ORIGIN', value: 'https://example.com', isSecret: false }
		]);
	});

	it('parses multiple lines', () => {
		const rows = parseDotenv('A=1\nB=2');
		expect(rows.map((r) => [r.key, r.value])).toEqual([
			['A', '1'],
			['B', '2']
		]);
	});

	it('handles CRLF line endings', () => {
		expect(parseDotenv('A=1\r\nB=2').map((r) => r.key)).toEqual(['A', 'B']);
	});

	it('skips blank lines and whole-line comments', () => {
		const rows = parseDotenv('# a note\n\nA=1\n   \n# another\nB=2');
		expect(rows.map((r) => r.key)).toEqual(['A', 'B']);
	});

	it('strips a leading export', () => {
		expect(parseDotenv('export ORIGIN=https://example.com')[0]).toEqual({
			key: 'ORIGIN',
			value: 'https://example.com',
			isSecret: false
		});
	});

	it('trims whitespace around the key', () => {
		expect(parseDotenv('  ORIGIN  =https://example.com')[0].key).toBe('ORIGIN');
	});

	it('splits on the first = only', () => {
		expect(parseDotenv('DATABASE_URL=postgres://u:p@host/db?a=1')[0].value).toBe(
			'postgres://u:p@host/db?a=1'
		);
	});

	it('treats a line with no = as a key with an empty value', () => {
		expect(parseDotenv('ORIGIN')).toEqual([{ key: 'ORIGIN', value: '', isSecret: false }]);
	});

	it('cleans the paste that broke the workshopeuropa deploy', () => {
		const pasted = [
			'# Copy to .env and fill in.',
			'BETTER_AUTH_SECRET=s3cr3t   # openssl rand -base64 32',
			'ORIGIN=https://workshopeuropa.com   # required by adapter-node',
			'PORT=3000   # adapter-node default',
			'DATABASE_URL=./data/workshop.db'
		].join('\n');

		expect(parseDotenv(pasted)).toEqual([
			{ key: 'BETTER_AUTH_SECRET', value: 's3cr3t', isSecret: true },
			{ key: 'ORIGIN', value: 'https://workshopeuropa.com', isSecret: false },
			{ key: 'PORT', value: '3000', isSecret: false },
			{ key: 'DATABASE_URL', value: './data/workshop.db', isSecret: true }
		]);
	});

	it('returns no rows for empty input', () => {
		expect(parseDotenv('')).toEqual([]);
	});

	it('returns no rows for comment-only input', () => {
		expect(parseDotenv('# just a note\n# and another')).toEqual([]);
	});
});

describe('looksSecret', () => {
	it.each(['BETTER_AUTH_SECRET', 'API_TOKEN', 'DB_PASSWORD', 'STRIPE_SECRET_KEY', 'SESSION_SALT'])(
		'marks %s as secret',
		(key) => {
			expect(looksSecret(key)).toBe(true);
		}
	);

	it.each(['ORIGIN', 'PORT', 'NODE_ENV', 'BETTER_AUTH_URL', 'HOST'])(
		'marks %s as not secret',
		(key) => {
			expect(looksSecret(key)).toBe(false);
		}
	);

	it('treats DATABASE_URL as secret because it usually carries credentials', () => {
		expect(looksSecret('DATABASE_URL')).toBe(true);
	});

	it.each(['PUBLIC_API_KEY', 'VITE_API_TOKEN', 'NEXT_PUBLIC_SECRET_NAME'])(
		'never marks client-exposed %s as secret',
		(key) => {
			expect(looksSecret(key)).toBe(false);
		}
	);

	it('is case insensitive', () => {
		expect(looksSecret('better_auth_secret')).toBe(true);
	});

	it('returns false for an empty key', () => {
		expect(looksSecret('   ')).toBe(false);
	});
});
