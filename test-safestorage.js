const { app, safeStorage } = require('electron')

app.whenReady().then(() => {
  console.log("SafeStorage available:", safeStorage.isEncryptionAvailable());
  app.quit();
})
