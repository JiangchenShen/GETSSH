import { app } from 'electron';
import path from 'path';

/**
 * Resolves the path to a rust-core native module.
 *
 * - Development: `<workspace>/rust-core/<moduleName>`
 * - Production (packaged): `<Resources>/rust-core/<moduleName>`
 *   (because rust-core modules are placed in extraResources → Resources/rust-core/)
 */
export function getRustCorePath(moduleName: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'rust-core', moduleName);
  }
  // Development: app.getAppPath() = .../apps/getssh-client
  return path.join(app.getAppPath(), '../../rust-core', moduleName);
}
