const challengeStr = "GETSSH-SECURE-CHALLENGE-" + Date.now();
const challenge = new Uint8Array(challengeStr.split('').map(c => c.charCodeAt(0)));
const userIdStr = "getssh-user";
const userId = new Uint8Array(userIdStr.split('').map(c => c.charCodeAt(0)));

let currentAbortController: AbortController | null = null;

export async function promptWebAuthn(attachment?: 'platform' | 'cross-platform'): Promise<boolean> {
  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = new AbortController();

  try {
    // Determine a valid RP ID (WebAuthn fails strictly if origin is file:// and rp.id doesn't match)
    // For file:// protocols, we just omit rp.id entirely and let Chromium try to infer, 
    // although it will likely still throw a DOMException if it's unsigned on macOS.
    const isFileProtocol = window.location.protocol === 'file:';
    const rpId = isFileProtocol ? undefined : (window.location.hostname || "localhost");

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: "GETSSH Client",
          ...(rpId ? { id: rpId } : {})
        },
        user: {
          id: userId,
          name: "GETSSH User",
          displayName: "GETSSH Local User"
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 }
        ],
        authenticatorSelection: {
          userVerification: "preferred",
          ...(attachment ? { authenticatorAttachment: attachment } : {})
        },
        timeout: 60000
      },
      signal: currentAbortController.signal
    });
    
    currentAbortController = null;
    return !!credential;
  } catch (error) {
    currentAbortController = null;
    console.error("WebAuthn error:", error);
    if (error instanceof DOMException) {
      if (error.name === 'AbortError') {
        return false;
      }
      // If macOS intercepts it due to lack of signing/entitlements, it throws NotAllowedError
      if (error.message.includes('not allowed') || error.name === 'NotAllowedError') {
        throw new Error('MAC_WEBAUTHN_BLOCKED');
      }
    }
    throw error;
  }
}
