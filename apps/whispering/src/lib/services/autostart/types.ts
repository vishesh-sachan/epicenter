import { createTaggedError } from 'wellcrafted/error';
import type { Result } from 'wellcrafted/result';

export const { AutostartServiceError, AutostartServiceErr } = createTaggedError(
	'AutostartServiceError',
);
export type AutostartServiceError = ReturnType<typeof AutostartServiceError>;

export type AutostartService = {
	isEnabled: () => Promise<Result<boolean, AutostartServiceError>>;
	enable: () => Promise<Result<void, AutostartServiceError>>;
	disable: () => Promise<Result<void, AutostartServiceError>>;
};
