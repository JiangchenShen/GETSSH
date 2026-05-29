const { URL } = require('url');
const reqUrl = 'getssh-plugin://sdk-tester/index.html';
const parsed = new URL(reqUrl);
console.log('hostname:', parsed.hostname);
console.log('pathname:', parsed.pathname);
