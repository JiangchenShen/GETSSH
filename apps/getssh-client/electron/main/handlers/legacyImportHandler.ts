import { app, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { appLock } from '../security/appLock';
import { DatabaseManager } from '../services/DatabaseManager';
import { toStoreError } from '../services/getsshStore';
import { applyV2DefaultPort, getV2ImportState, importV2WithPassword } from '../services/legacyV2Profiles';
import { isMainWebContents } from '../windowRegistry';
import { getActiveWorkspaceId } from './workspaceHandler';

/**
 * Server profiles saved by GETSSH 2.0 (services/legacyV2Profiles.ts). appLock imports them by
 * itself when no password is needed; these channels let the window ask whether a 2.0 list is
 * still waiting and send the 2.0 master password the user typed.
 *
 * Only the top frame of the main window may call them, and only while the app is unlocked. The
 * import saves the whole profile list of the MAIN workspace, so its answer carries the active
 * workspace's new list: the window must replace its own with it, or its next save-profiles
 * (also a whole-list save) would remove the imported rows again.
 *
 * legacy-v2:apply-default-port takes the window's appConfig.defaultPort once, for the servers
 * the automatic import gave 22 (status: imported.portDefaulted > 0), and answers the same way.
 */

type Failure = { ok: false; error: string };

const UNAUTHORIZED: Failure = { ok: false, error: 'unauthorized' };
const INVALID: Failure = { ok: false, error: 'invalid_argument' };

function allowed(event: IpcMainInvokeEvent): boolean {
  return isMainWebContents(event.sender) && event.senderFrame?.parent === null && appLock.isReady();
}

function failure(error: unknown): Failure {
  // Only the code: a message could quote what was being read.
  const code = toStoreError(error).code;
  console.warn('[LegacyV2 IPC]', code);
  return { ok: false, error: code };
}

/** null: no password given (the saved 2.0 password is tried); undefined: not acceptable. */
function typedPassword(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' && value.length <= 4096 ? value : undefined;
}

function defaultPort(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65535 ? (value as number) : undefined;
}

export function registerLegacyImportHandlers(ipcMain: IpcMain) {
  ipcMain.handle('legacy-v2:status', async event => {
    if (!allowed(event)) return UNAUTHORIZED;
    try {
      const state = await getV2ImportState(app.getPath('userData'));
      return { ok: true, kind: state.kind, needsPassword: state.needsPassword, imported: state.imported };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('legacy-v2:apply-default-port', async (event, request: unknown) => {
    if (!allowed(event)) return UNAUTHORIZED;
    const body = request ?? {};
    if (typeof body !== 'object' || Array.isArray(body)) return INVALID;
    const port = defaultPort((body as Record<string, unknown>).port);
    if (port === undefined) return INVALID;
    try {
      const outcome = await applyV2DefaultPort(port);
      const workspaceId = getActiveWorkspaceId();
      return { ok: true, ...outcome, workspaceId, profiles: DatabaseManager.getProfiles(workspaceId) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('legacy-v2:import', async (event, request: unknown) => {
    if (!allowed(event)) return UNAUTHORIZED;
    const body = request ?? {};
    if (typeof body !== 'object' || Array.isArray(body)) return INVALID;
    const { password, defaultPort: port } = body as Record<string, unknown>;
    const typed = typedPassword(password);
    if (typed === undefined) return INVALID;
    try {
      const outcome = await importV2WithPassword(app.getPath('userData'), typed, { defaultPort: defaultPort(port) });
      const workspaceId = getActiveWorkspaceId();
      return { ok: true, ...outcome, workspaceId, profiles: DatabaseManager.getProfiles(workspaceId) };
    } catch (error) {
      return failure(error);
    }
  });
}
