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
} else if (platform === 'linux' && arch === 'x64') {
  bindingFilename = 'sftp-stream.linux-x64-gnu.node';
} else if (platform === 'linux' && arch === 'arm64') {
  bindingFilename = 'sftp-stream.linux-arm64-gnu.node';
} else {
  bindingFilename = `sftp-stream.${platform}-${arch}.node`;
}

let bindingPath = join(__dirname, bindingFilename);
let addon;

try {
  addon = require(bindingPath);
} catch (e) {
  if (platform === 'linux') {
    try {
      bindingPath = bindingPath.replace('-gnu', '-musl');
      addon = require(bindingPath);
    } catch (e2) {
      throw new Error(`Failed to load native binding (tried gnu and musl): ${e2.message}`);
    }
  } else {
    throw new Error(`Failed to load native binding at ${bindingPath}: ${e.message}`);
  }
}

module.exports = {
  SftpDownloader: addon.SftpDownloader,
  SftpUploader: addon.SftpUploader
};
