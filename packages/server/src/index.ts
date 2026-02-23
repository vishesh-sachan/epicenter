export { createServer, DEFAULT_PORT, type ServerConfig } from './server';
export { createHubServer, type HubServerConfig } from './hub';
export { createSidecarServer, type SidecarServerConfig } from './sidecar';
export { createAuthPlugin, createBetterAuth, type AuthPluginConfig } from './auth';
export { createHubSessionValidator, type HubSessionValidatorConfig, type SessionValidationResult } from './auth/sidecar-auth';
export { createKeyManagementPlugin, createKeyStore, type KeyStore } from './keys';
export { createProxyPlugin, type ProxyPluginConfig } from './proxy';
export {
	createClientPresence,
	createSidecarPresence,
	DISCOVERY_ROOM_ID,
	getDiscoveredDevices,
	type DeviceCapability,
	type DeviceType,
	type DiscoveryState,
} from './discovery';
export { createWorkspacePlugin } from './workspace';
