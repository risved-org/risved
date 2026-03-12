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
		description: 'Deno-native full-stack framework with island architecture',
		repoUrl: 'https://github.com/risved/starter-fresh',
		estimatedTime: '~10s'
	},
	{
		id: 'hono',
		name: 'Hono',
		framework: 'hono',
		description: 'Ultrafast web framework for the edge and Deno',
		repoUrl: 'https://github.com/risved/starter-hono',
		estimatedTime: '~8s'
	},
	{
		id: 'sveltekit',
		name: 'SvelteKit',
		framework: 'sveltekit',
		description: 'Full-stack framework with SSR, routing, and adapters',
		repoUrl: 'https://github.com/risved/starter-sveltekit',
		estimatedTime: '~25s'
	},
	{
		id: 'astro',
		name: 'Astro',
		framework: 'astro',
		description: 'Content-focused framework with zero JS by default',
		repoUrl: 'https://github.com/risved/starter-astro',
		estimatedTime: '~20s'
	}
];
