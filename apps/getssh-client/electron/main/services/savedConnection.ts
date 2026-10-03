import { isValidWorkspaceId } from '../utils/workspaceId';
import { getStore } from './getsshStore';

/**
 * Connecting to a saved profile by its id: the main process takes the address and the credentials
 * from getssh-store, never from the request. A request naming a saved profile (the renderer, or a
 * plugin through the plugin bridge) therefore cannot send its password to another host.
 *
 * Credentials the user typed for this one connection (quick connect, an unsaved draft, a password
 * edited but not saved yet) still come with the request and are used as they are.
 */

export interface SavedConnection {
  host: string;
  port: number;
  username: string;
  /** A string: ssh2 ignores a Buffer password. */
  password?: string;
  passphrase?: Buffer;
  privateKey?: Buffer;
  /** Zero-fills the key and passphrase once the handshake is over. */
  wipe(): void;
}

export interface ConnectRequest {
  profileId?: unknown;
  workspaceId?: unknown;
  password?: unknown;
  passphrase?: unknown;
}

/** The request brings a password or passphrase of its own. */
export function hasTypedCredentials(request: ConnectRequest): boolean {
  return (typeof request.password === 'string' && request.password.length > 0) ||
    (typeof request.passphrase === 'string' && request.passphrase.length > 0);
}

/**
 * The saved profile's address and credentials, or null when the request brings its own
 * credentials or names no saved profile. Throws a store error when the workspace is locked or a
 * key file cannot be read.
 */
export function savedConnection(request: ConnectRequest): SavedConnection | null {
  if (hasTypedCredentials(request)) return null;
  const { profileId, workspaceId } = request;
  if (typeof profileId !== 'string' || !profileId || !isValidWorkspaceId(workspaceId)) return null;
  const store = getStore();
  const profile = store.listProfiles(workspaceId).find(entry => entry.id === profileId);
  if (!profile) return null;
  const secrets = store.connectSecrets(workspaceId, profileId);
  const password = secrets.password?.toString('utf8');
  secrets.password?.fill(0);
  const { passphrase, privateKey } = secrets;
  return {
    host: profile.host,
    port: profile.port,
    username: profile.username,
    password,
    passphrase,
    privateKey,
    wipe() {
      passphrase?.fill(0);
      privateKey?.fill(0);
    },
  };
}
