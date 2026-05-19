const path = require('path');
const AdmZip = require('adm-zip');

const pluginDir = path.join(__dirname, '..', 'plugins', 'system-monitor');
const outputDir = path.join(__dirname, '..');
const outputFile = path.join(outputDir, 'system-monitor.zip');

function packagePlugin() {
  console.log(`Packaging plugin from ${pluginDir} to ${outputFile}...`);
  
  try {
    const zip = new AdmZip();
    zip.addLocalFolder(pluginDir);
    zip.writeZip(outputFile);
    console.log(`Plugin packaged successfully to ${outputFile}`);
  } catch (err) {
    console.error('Failed to package plugin:', err);
    process.exit(1);
  }
}

packagePlugin();
