'use strict';

const path = require('node:path');
const sentinel = require(path.resolve(__dirname, '../../../../rust-core/getssh-sentinel'));

const original = 'export GITHUB_TOKEN=ghp_aBcDeF1234567890';
const sanitized = sentinel.sanitize(original);
if (sanitized.cleanText !== 'export GITHUB_TOKEN=[SECRET_1]') {
  throw new Error(`environment token was not sanitized: ${sanitized.cleanText}`);
}
if (sentinel.rehydrate(sanitized.cleanText, sanitized.mappingDict) !== original) {
  throw new Error('safe atomic token did not rehydrate');
}

const injectionToken = '[SECRET_1]';
const injectionMapping = { [injectionToken]: 'safe; touch /tmp/getssh-pwned' };
if (sentinel.rehydrate(`echo ${injectionToken}`, injectionMapping) !== `echo ${injectionToken}`) {
  throw new Error('AST invariant allowed a secret to add shell syntax');
}

const quoted = sentinel.rehydrate(`echo "${injectionToken}"`, injectionMapping);
if (quoted !== 'echo "safe; touch /tmp/getssh-pwned"') {
  throw new Error('AST invariant rejected quoted data that preserves syntax shape');
}

console.log('sentinel sanitization/rehydration smoke passed');
