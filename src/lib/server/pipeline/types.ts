import type { FrameworkId, Tier } from '../detection/types';

/** Pipeline execution phases in order */
export type PipelinePhase =
	| 'clone'
	| 'detect'
	| 'build'
	| 'release'
	| 'start'
	| 'health'
	| 'route'
	| 'cutover'
	| 'live';

/** Log severity levels */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

/** A single log entry emitted during pipeline execution */
export interface LogEntry {
	timestamp: string;
	phase: PipelinePhase;
	level: LogLevel;
	message: string;
}

/** Configuration for a pipeline run */
export interface PipelineConfig {
	projectId: string;
	projectSlug: string;
	repoUrl: string;
	branch: string;
	port: number;
	domain?: string;
	/** Override the detected framework */
	frameworkId?: FrameworkId;
	/** Override the detected tier */
	tier?: Tier;
	/** Shell command to run once per deploy before traffic switches. Null/empty skips the phase. */
	releaseCommand?: string | null;
}

/** Result of a completed pipeline run */
export interface PipelineResult {
	success: boolean;
	deploymentId: string;
	commitSha?: string;
	imageTag?: string;
	containerName?: string;
	error?: string;
	logs: LogEntry[];
}

/** Callback for streaming log entries during pipeline execution */
export type LogEmitter = (entry: LogEntry) => void;

/** Options for Docker operations */
export interface DockerBuildOptions {
	contextDir: string;
	imageTag: string;
	network?: string;
	/** Build-time environment variables (passed as --build-arg) */
	buildArgs?: Record<string, string>;
	/** Called for each line of build output (enables streaming) */
	onLine?: (line: string) => void;
}

export interface DockerRunOptions {
	imageTag: string;
	containerName: string;
	port: number;
	network?: string;
	env?: Record<string, string>;
	volumes?: string[];
}

/** Interface for shell command execution (allows mocking in tests) */
export interface CommandRunner {
	exec(cmd: string, args: string[], options?: { cwd?: string; env?: Record<string, string>; onLine?: (line: string) => void }): Promise<CommandResult>;
}

export interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}
