export type StarterTemplate = {
	id: string;
	name: string;
	framework: string;
	description: string;
	repoUrl: string;
	estimatedTime: string;
};

export const STARTER_TEMPLATES: StarterTemplate[] = [
	{
		id: 'fresh',
		name: 'Fresh',
		framework: 'fresh',
		description: 'A deno-native server-side framework with islands',
		repoUrl: 'https://github.com/risved/starter-fresh',
		estimatedTime: '~10s'
	},
	{
		id: 'hono',
		name: 'Hono',
		framework: 'hono',
		description: 'Fast, lightweight server-side framework with middleware',
		repoUrl: 'https://github.com/risved/starter-hono',
		estimatedTime: '~8s'
	},
	{
		id: 'sveltekit',
		name: 'SvelteKit',
		framework: 'sveltekit',
		description: 'A hybrid server- and client-side framework with great syntax',
		repoUrl: 'https://github.com/risved/starter-sveltekit',
		estimatedTime: '~25s'
	},
	{
		id: 'astro',
		name: 'Astro',
		framework: 'astro',
		description: 'A server-side framework for building content-driven websites',
		repoUrl: 'https://github.com/risved/starter-astro',
		estimatedTime: '~20s'
	}
];
