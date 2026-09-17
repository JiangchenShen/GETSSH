const { join } = require('path');
const { existsSync } = require('fs');

const { platform, arch } = process;
let bindingFilename;

if (platform === 'win32' && arch === 'x64') {
  bindingFilename = 'sftp-stream.win32-x64-msvc.node';
} else if (platform === 'win32' && arch === 'arm64') {
  bindingFilename = 'sftp-stream.win32-arm64-msvc.node';
} else if (platform === 'darwin' && arch === 'x64') {
  bindingFilename = 'sftp-stream.darwin-x64.node';
} else if (platform === 'darwin' && arch === 'arm64') {
  bindingFilename = 'sftp-stream.darwin-arm64.node';
} else {
  throw new Error(`Unsupported OS: ${platform}, architecture: ${arch}`);
}

let bindingPath = join(__dirname, bindingFilename);
let addon;

try {
  addon = require(bindingPath);
} catch (e) {
  throw new Error(`Failed to load native binding at ${bindingPath}: ${e.message}`);
}

module.exports = {
  SftpDownloader: addon.SftpDownloader,
  SftpUploader: addon.SftpUploader
};
