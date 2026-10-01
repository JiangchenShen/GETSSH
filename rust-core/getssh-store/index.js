// Loads the getssh-store.<platform>.node that scripts/build-native.js builds (napi build --platform).
// GETSSH desktop builds exist only for these four targets.
const { join } = require('node:path')

const SUFFIXES = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-x64',
  'win32-arm64': 'win32-arm64-msvc',
  'win32-x64': 'win32-x64-msvc',
}

const suffix = SUFFIXES[`${process.platform}-${process.arch}`]
if (!suffix) throw new Error(`getssh-store is not built for ${process.platform}-${process.arch}`)

module.exports = require(join(__dirname, `getssh-store.${suffix}.node`))
