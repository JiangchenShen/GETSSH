const { existsSync } = require('fs')
const { join } = require('path')

const { platform, arch } = process

let nativeBinding = null
let localFileExisted = false
let loadError = null

switch (platform) {
  case 'android':
    switch (arch) {
      case 'arm64':
        localFileExisted = existsSync(join(__dirname, 'getssh-unarchive.android-arm64.node'))
        try {
          if (localFileExisted) {
            nativeBinding = require('./getssh-unarchive.android-arm64.node')
          } else {
            nativeBinding = require('getssh-unarchive-android-arm64')
          }
        } catch (e) {
          loadError = e
        }
        break
      case 'arm':
        localFileExisted = existsSync(join(__dirname, 'getssh-unarchive.android-arm-eabi.node'))
        try {
          if (localFileExisted) {
            nativeBinding = require('./getssh-unarchive.android-arm-eabi.node')
          } else {
            nativeBinding = require('getssh-unarchive-android-arm-eabi')
          }
        } catch (e) {
          loadError = e
        }
        break
      default:
        throw new Error(`Unsupported architecture on Android ${arch}`)
    }
    break
  case 'win32':
    switch (arch) {
      case 'x64':
        localFileExisted = existsSync(join(__dirname, 'getssh-unarchive.win32-x64-msvc.node'))
        try {
          if (localFileExisted) {
            nativeBinding = require('./getssh-unarchive.win32-x64-msvc.node')
          } else {
            nativeBinding = require('getssh-unarchive-win32-x64-msvc')
          }
        } catch (e) {
          loadError = e
        }
        break
      case 'ia32':
        localFileExisted = existsSync(join(__dirname, 'getssh-unarchive.win32-ia32-msvc.node'))
        try {
          if (localFileExisted) {
            nativeBinding = require('./getssh-unarchive.win32-ia32-msvc.node')
          } else {
            nativeBinding = require('getssh-unarchive-win32-ia32-msvc')
          }
        } catch (e) {
          loadError = e
        }
        break
      case 'arm64':
        localFileExisted = existsSync(join(__dirname, 'getssh-unarchive.win32-arm64-msvc.node'))
        try {
          if (localFileExisted) {
            nativeBinding = require('./getssh-unarchive.win32-arm64-msvc.node')
          } else {
            nativeBinding = require('getssh-unarchive-win32-arm64-msvc')
          }
        } catch (e) {
          loadError = e
        }
        break
      default:
        throw new Error(`Unsupported architecture on Windows: ${arch}`)
    }
    break
  case 'darwin':
    localFileExisted = existsSync(join(__dirname, 'getssh-unarchive.darwin-universal.node'))
    try {
      if (localFileExisted) {
        nativeBinding = require('./getssh-unarchive.darwin-universal.node')
      } else {
        nativeBinding = require('getssh-unarchive-darwin-universal')
      }
      break
    } catch {}
    switch (arch) {
      case 'x64':
        localFileExisted = existsSync(join(__dirname, 'getssh-unarchive.darwin-x64.node'))
        try {
          if (localFileExisted) {
            nativeBinding = require('./getssh-unarchive.darwin-x64.node')
          } else {
            nativeBinding = require('getssh-unarchive-darwin-x64')
          }
        } catch (e) {
          loadError = e
        }
        break
      case 'arm64':
        localFileExisted = existsSync(join(__dirname, 'getssh-unarchive.darwin-arm64.node'))
        try {
          if (localFileExisted) {
            nativeBinding = require('./getssh-unarchive.darwin-arm64.node')
          } else {
            nativeBinding = require('getssh-unarchive-darwin-arm64')
          }
        } catch (e) {
          loadError = e
        }
        break
      default:
        throw new Error(`Unsupported architecture on macOS: ${arch}`)
    }
    break
  case 'freebsd':
    if (arch !== 'x64') {
      throw new Error(`Unsupported architecture on FreeBSD: ${arch}`)
    }
    localFileExisted = existsSync(join(__dirname, 'getssh-unarchive.freebsd-x64.node'))
    try {
      if (localFileExisted) {
        nativeBinding = require('./getssh-unarchive.freebsd-x64.node')
      } else {
        nativeBinding = require('getssh-unarchive-freebsd-x64')
      }
    } catch (e) {
      loadError = e
    }
    break
  default:
    throw new Error(`Unsupported OS: ${platform}, architecture: ${arch}`)
}

if (!nativeBinding) {
  if (loadError) {
    throw loadError
  }
  throw new Error(`Failed to load native binding`)
}

const { extractPlugin } = nativeBinding

module.exports.extractPlugin = extractPlugin
