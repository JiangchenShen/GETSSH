import { app } from 'electron';

/**
 * A user folder from app.getPath, or null when the system cannot give it. On Windows,
 * app.getPath('documents') (and 'downloads', 'desktop') throws when the known folder does not
 * exist, for example a Documents folder redirected to a share or OneDrive that is not there.
 * Callers that only want a starting folder for a dialog fall back instead of failing.
 */
export function userFolder(name: 'documents' | 'downloads' | 'desktop' | 'home'): string | null {
  try {
    return app.getPath(name) || null;
  } catch {
    return null;
  }
}

/** Where a save dialog starts: the folder, else the home folder, else wherever the dialog likes. */
export function dialogFolder(name: 'documents' | 'downloads' | 'desktop'): string {
  return userFolder(name) ?? userFolder('home') ?? '';
}
