export type StarterTemplate = {
	id: string
	name: string
	framework: string
	description: string
	repoUrl: string
	estimatedTime: string
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
	{
		id: 'sveltekit',
		name: 'SvelteKit',
		framework: 'sveltekit',
		description: 'A server- and client-side framework with great syntax',
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
]
