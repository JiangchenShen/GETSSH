const { join } = require('path');
let addon;
try {
  addon = require(`./sftp-stream.${process.platform}-${process.arch}.node`);
} catch (e) {
  throw new Error(`Failed to load native binding: ${e.message}`);
}
module.exports = {
  SftpDownloader: addon.SftpDownloader,
  SftpUploader: addon.SftpUploader
};
