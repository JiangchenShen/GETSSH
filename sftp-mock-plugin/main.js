module.exports = {
  activate: (context) => {
    console.log("[SFTP Core] Engine Bootstrapped successfully.");
    context.showNotification("GETSSH Payload Loaded", "SFTP Extension is now listening for IPC events!");
  }
};
