import path from 'node:path';
import os from 'node:os';

/**
 * Workspace ids double as directory names (~/.getssh/workspaces/<id>) and file names (workspace_<id>.db),
 * and the UI uses the typed workspace name as the id. An id such as ".." or "../.." would point
 * workspace:create / workspace:delete (which removes the directory recursively) at ~/.getssh or the
 * home directory itself. Reject anything that can leave the workspaces directory or is not a portable
 * file name on macOS / Windows; everything else, including CJK names and inner spaces, stays allowed.
 */
const MAX_WORKSPACE_ID_LENGTH = 128;
const FORBIDDEN_CHARS = /[/\\:*?"<>|\u0000-\u001f\u007f]/;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function isValidWorkspaceId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (id.length === 0 || id.length > MAX_WORKSPACE_ID_LENGTH) return false;
  if (id !== id.trim()) return false;
  // Leading dots cover "." and ".."; trailing dots are silently stripped by Windows.
  if (id.startsWith('.') || id.endsWith('.')) return false;
  if (FORBIDDEN_CHARS.test(id)) return false;
  if (WINDOWS_RESERVED_NAMES.test(id)) return false;
  return true;
}

export function getWorkspacesRoot(): string {
  return path.join(os.homedir(), '.getssh', 'workspaces');
}

/** Directory of a workspace. Throws unless `id` is valid and the result lies strictly inside the workspaces root. */
export function resolveWorkspaceDir(id: unknown): string {
  if (!isValidWorkspaceId(id)) throw new Error('Invalid workspace id');
  const root = getWorkspacesRoot();
  const dir = path.resolve(root, id);
  const relative = path.relative(root, dir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error('Invalid workspace id');
  }
  return dir;
}
