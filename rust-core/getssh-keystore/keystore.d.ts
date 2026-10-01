/* tslint:disable */
/* eslint-disable */

/* Hand-written to match src/lib.rs (the napi CLI does not emit types for this crate and would
 * overwrite index.d.ts). Errors are thrown as Error("[keystore:<code>] <detail>"). */

export interface ScopeStatus {
  id: string
  protected: boolean
  ownPassword: boolean
  presence: boolean
  unlocked: boolean
  staged: boolean
  recovery: boolean
  masterLinked: boolean
  revealRemainingMs?: number
}
export interface KeystoreStatus {
  initialized: boolean
  appProtected: boolean
  recoveryConfigured: boolean
  presenceSupported: boolean
  quietBackend?: string
  deviceKeyLost: boolean
  scopes: Array<ScopeStatus>
}
export declare function configure(keyringPath: string): void
export declare function status(): KeystoreStatus
export declare function initialize(): Promise<void>
export declare function openScope(scope: string): Promise<void>
export declare function unlockWithPassword(scope: string, password: string): Promise<void>
export declare function unlockWithPresence(scope: string, reason: string): Promise<void>
export declare function unlockWithRecovery(code: string): Promise<string[]>
export declare function lockProtected(): void
export declare function lockScope(scope: string): void
export declare function createScope(scope: string, password?: string | undefined | null): Promise<void>
export declare function createScopeWithLegacyPassword(scope: string, password: string): Promise<void>
export declare function deleteScope(scope: string): Promise<void>
export declare function setPassword(scope: string, password: string): Promise<string[]>
export declare function removePassword(scope: string): Promise<string[]>
export declare function enablePresence(scope: string, reason: string): Promise<void>
export declare function disablePresence(scope: string): Promise<void>
export declare function setupRecovery(): Promise<string>
export declare function removeRecovery(): Promise<void>
export declare function commitRotation(scope: string): Promise<void>
export declare function abortRotation(scope: string): Promise<void>
export declare function databaseKey(scope: string, label: string, staged?: boolean | undefined | null): Buffer
export declare function sealField(scope: string, context: string, plaintext: string): string
export declare function openField(scope: string, context: string, sealed: string): string
export declare function isSealedField(value: string): boolean
export declare function openRevealWithPresence(scope: string, reason: string): Promise<void>
export declare function openRevealWithPassword(scope: string, password: string): Promise<void>
export declare function revealField(scope: string, context: string, sealed: string): string
export declare function closeReveal(): void
export declare function verifyPresence(reason: string): Promise<void>
export declare function verifyPassword(scope: string, password: string): Promise<void>
export declare function probeDevice(): Promise<string>
export declare function setParentWindow(handle: Buffer): void
export declare function isRecoveryCodeWellFormed(code: string): boolean
