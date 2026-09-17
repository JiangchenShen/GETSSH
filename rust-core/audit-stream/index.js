// prettier-ignore
/* eslint-disable */
// @ts-nocheck

const path = require('node:path')

const loadErrors = []
const supportedPlatform = process.platform === 'darwin' || process.platform === 'win32'

function loadLocal(filename) {
  try {
    return require(path.join(__dirname, filename))
  } catch (error) {
    loadErrors.push(error)
    return null
  }
}

function loadPackage(packageName) {
  try {
    const binding = require(packageName)
    const version = require(`${packageName}/package.json`).version
    if (
      version !== '1.0.0' &&
      process.env.NAPI_RS_ENFORCE_VERSION_CHECK &&
      process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== '0'
    ) {
      throw new Error(
        `Native binding package version mismatch, expected 1.0.0 but got ${version}. ` +
        'Reinstall dependencies to fix this issue.'
      )
    }
    return binding
  } catch (error) {
    loadErrors.push(error)
    return null
  }
}

function loadBinding(filename, packageName) {
  return loadLocal(filename) || loadPackage(packageName)
}

function requireNative() {
  if (!supportedPlatform) {
    loadErrors.push(new Error(`Unsupported OS: ${process.platform}, architecture: ${process.arch}`))
    return null
  }

  if (process.env.NAPI_RS_NATIVE_LIBRARY_PATH) {
    try {
      return require(process.env.NAPI_RS_NATIVE_LIBRARY_PATH)
    } catch (error) {
      loadErrors.push(error)
    }
  }

  if (process.platform === 'darwin') {
    const universal = loadBinding(
      'audit_stream.darwin-universal.node',
      'audit-stream-darwin-universal'
    )
    if (universal) return universal
    if (process.arch === 'x64') {
      return loadBinding('audit_stream.darwin-x64.node', 'audit-stream-darwin-x64')
    }
    if (process.arch === 'arm64') {
      return loadBinding('audit_stream.darwin-arm64.node', 'audit-stream-darwin-arm64')
    }
    loadErrors.push(new Error(`Unsupported architecture on macOS: ${process.arch}`))
    return null
  }

  if (process.platform === 'win32') {
    if (process.arch === 'x64') {
      return loadBinding('audit_stream.win32-x64-msvc.node', 'audit-stream-win32-x64-msvc')
    }
    if (process.arch === 'arm64') {
      return loadBinding('audit_stream.win32-arm64-msvc.node', 'audit-stream-win32-arm64-msvc')
    }
    loadErrors.push(new Error(`Unsupported architecture on Windows: ${process.arch}`))
    return null
  }

  return null
}

let nativeBinding = requireNative()

const forceWasi =
  process.env.NAPI_RS_FORCE_WASI === 'true' || process.env.NAPI_RS_FORCE_WASI === 'error'

if (supportedPlatform && (!nativeBinding || forceWasi)) {
  let wasiBinding = null
  let wasiBindingError = null
  try {
    wasiBinding = require('./audit_stream.wasi.cjs')
    nativeBinding = wasiBinding
  } catch (error) {
    if (forceWasi) wasiBindingError = error
  }
  if (!nativeBinding || forceWasi) {
    try {
      wasiBinding = require('audit-stream-wasm32-wasi')
      nativeBinding = wasiBinding
    } catch (error) {
      if (forceWasi) {
        if (!wasiBindingError) {
          wasiBindingError = error
        } else {
          wasiBindingError.cause = error
        }
        loadErrors.push(error)
      }
    }
  }
  if (process.env.NAPI_RS_FORCE_WASI === 'error' && !wasiBinding) {
    const error = new Error('WASI binding not found and NAPI_RS_FORCE_WASI is set to error')
    error.cause = wasiBindingError
    throw error
  }
}

if (!nativeBinding) {
  throw new Error('Cannot find a supported native audit-stream binding.', {
    cause: loadErrors.reduce((previous, current) => {
      current.cause = previous
      return current
    }, undefined),
  })
}

module.exports = nativeBinding
module.exports.AuditStream = nativeBinding.AuditStream
