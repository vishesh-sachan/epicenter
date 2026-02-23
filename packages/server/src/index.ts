export {
	type AuthPluginConfig,
	createAuthPlugin,
	createBetterAuth,
} from './auth';
export {
	createHubSessionValidator,
	type HubSessionValidatorConfig,
	type SessionValidationResult,
} from './auth/sidecar-auth';
export {
	createClientPresence,
	createSidecarPresence,
	type DeviceCapability,
	type DeviceType,
	DISCOVERY_ROOM_ID,
	type DiscoveryState,
	getDiscoveredDevices,
} from './discovery';
export { createHubServer, type HubServerConfig } from './hub';
export {
	createKeyManagementPlugin,
	createKeyStore,
	type KeyStore,
} from './keys';
export {
	createOpenCodeProcess,
	type GenerateConfigOptions,
	generateOpenCodeConfig,
	generateOpenCodeConfigContent,
	type OpenCodeConfig,
	type OpenCodeProcess,
	type OpenCodeProcessConfig,
} from './opencode';
export { createProxyPlugin, type ProxyPluginConfig } from './proxy';
export { createServer, DEFAULT_PORT, type ServerConfig } from './server';
export { createSidecarServer, type SidecarServerConfig } from './sidecar';
export { createWorkspacePlugin } from './workspace';
