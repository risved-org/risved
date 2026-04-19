/** Minimal project data needed for preview operations. */
export interface PreviewProject {
	id: string;
	slug: string;
	repoUrl: string;
	branch: string;
	frameworkId: string | null;
	tier: string | null;
	previewLimit: number;
	previewsEnabled: boolean;
	previewAutoDelete: boolean;
	releaseCommand: string | null;
}

/** Result of creating a preview deployment. */
export interface PreviewResult {
	success: boolean;
	previewId?: string;
	domain?: string;
	port?: number;
	error?: string;
}
