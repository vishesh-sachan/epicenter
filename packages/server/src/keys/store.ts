import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SupportedProvider } from '../ai/adapters';

/**
 * Encrypted API key store.
 *
 * Stores provider API keys at `~/.epicenter/server/keys.json`, encrypted
 * with AES-256-GCM using a 256-bit master key at `~/.epicenter/server/master.key`.
 *
 * The master key is auto-generated on first use. Keys are encrypted individually
 * so that reading the file without the master key reveals only provider names,
 * not the actual API key values.
 *
 * @example
 * ```typescript
 * const store = createKeyStore();
 * store.set('openai', 'sk-...');
 * const key = store.get('openai'); // 'sk-...'
 * store.remove('openai');
 * const providers = store.list(); // ['anthropic', 'gemini']
 * ```
 */

/** Encrypted key entry as stored in keys.json. */
type EncryptedEntry = {
	/** Base64-encoded IV (12 bytes for AES-256-GCM). */
	iv: string;
	/** Base64-encoded ciphertext + auth tag. */
	data: string;
};

/** On-disk format of keys.json. */
type KeyFile = Record<string, EncryptedEntry>;

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // AES-GCM standard
const KEY_LENGTH = 32; // 256 bits

/**
 * Get the default key store directory path.
 *
 * Uses `~/.epicenter/server/` following the convention from the
 * server-side-api-key-management spec.
 */
function defaultStoreDir(): string {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
	return join(home, '.epicenter', 'server');
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

/**
 * Load or generate the 256-bit master key.
 *
 * If master.key exists, reads and returns it. Otherwise generates
 * a cryptographically random 256-bit key and writes it.
 */
function loadOrCreateMasterKey(storeDir: string): Buffer {
	const keyPath = join(storeDir, 'master.key');

	if (existsSync(keyPath)) {
		return Buffer.from(readFileSync(keyPath));
	}

	ensureDir(storeDir);
	const key = crypto.getRandomValues(new Uint8Array(KEY_LENGTH));
	const keyBuffer = Buffer.from(key);
	writeFileSync(keyPath, keyBuffer, { mode: 0o600 });
	return keyBuffer;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 */
async function encrypt(
	plaintext: string,
	masterKey: Buffer,
): Promise<EncryptedEntry> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const encoder = new TextEncoder();
	const data = encoder.encode(plaintext);

	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		masterKey,
		{ name: 'AES-GCM' },
		false,
		['encrypt'],
	);

	const encrypted = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		cryptoKey,
		data,
	);

	return {
		iv: Buffer.from(iv).toString('base64'),
		data: Buffer.from(encrypted).toString('base64'),
	};
}

/**
 * Decrypt an AES-256-GCM encrypted entry.
 */
async function decrypt(
	entry: EncryptedEntry,
	masterKey: Buffer,
): Promise<string> {
	const iv = Buffer.from(entry.iv, 'base64');
	const data = Buffer.from(entry.data, 'base64');

	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		masterKey,
		{ name: 'AES-GCM' },
		false,
		['decrypt'],
	);

	const decrypted = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv },
		cryptoKey,
		data,
	);

	return new TextDecoder().decode(decrypted);
}

/**
 * Load the key file from disk.
 */
function loadKeyFile(keysPath: string): KeyFile {
	if (!existsSync(keysPath)) return {};

	const raw = readFileSync(keysPath, 'utf-8');
	return JSON.parse(raw) as KeyFile;
}

/**
 * Write the key file to disk.
 */
function saveKeyFile(keysPath: string, data: KeyFile): void {
	ensureDir(dirname(keysPath));
	writeFileSync(keysPath, JSON.stringify(data, null, '\t'), {
		mode: 0o600,
	});
}

export type KeyStore = {
	/**
	 * Store an API key for a provider.
	 *
	 * Encrypts the key with AES-256-GCM and persists to disk.
	 * Overwrites any existing key for the same provider.
	 */
	set(provider: string, apiKey: string): Promise<void>;

	/**
	 * Retrieve the decrypted API key for a provider.
	 *
	 * @returns The plaintext key, or `undefined` if not stored.
	 */
	get(provider: string): Promise<string | undefined>;

	/**
	 * Remove the stored key for a provider.
	 *
	 * @returns `true` if a key was removed, `false` if none existed.
	 */
	remove(provider: string): boolean;

	/**
	 * List all providers that have stored keys.
	 *
	 * Returns provider names only — not the keys themselves.
	 */
	list(): string[];
};

/**
 * Create an encrypted API key store.
 *
 * Keys are stored at `{storeDir}/keys.json`, encrypted with a master key
 * at `{storeDir}/master.key`. Both files are created automatically on
 * first use with restrictive permissions (0600).
 *
 * @param storeDir - Directory for keys.json and master.key. Defaults to `~/.epicenter/server/`.
 *
 * @example
 * ```typescript
 * const store = createKeyStore();
 *
 * await store.set('openai', 'sk-...');
 * const key = await store.get('openai'); // 'sk-...'
 *
 * store.list();     // ['openai']
 * store.remove('openai'); // true
 * store.list();     // []
 * ```
 */
export function createKeyStore(storeDir?: string): KeyStore {
	const dir = storeDir ?? defaultStoreDir();
	const masterKey = loadOrCreateMasterKey(dir);
	const keysPath = join(dir, 'keys.json');

	return {
		async set(provider, apiKey) {
			const keyFile = loadKeyFile(keysPath);
			keyFile[provider] = await encrypt(apiKey, masterKey);
			saveKeyFile(keysPath, keyFile);
		},

		async get(provider) {
			const keyFile = loadKeyFile(keysPath);
			const entry = keyFile[provider];
			if (!entry) return undefined;
			return decrypt(entry, masterKey);
		},

		remove(provider) {
			const keyFile = loadKeyFile(keysPath);
			if (!(provider in keyFile)) return false;
			delete keyFile[provider];
			saveKeyFile(keysPath, keyFile);
			return true;
		},

		list() {
			const keyFile = loadKeyFile(keysPath);
			return Object.keys(keyFile);
		},
	};
}
