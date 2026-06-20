const sentinel = require('../../rust-core/getssh-sentinel');
const text = "My IP is 192.168.1.100 and my DB_PASS='super_secret' and AWS key AKIA1234567890ABCDEF.";
const sanitized = sentinel.sanitize(text);
console.log("Sanitized object keys:", Object.keys(sanitized));
console.log("Clean text:", sanitized.cleanText);
console.log("Dict:", sanitized.mappingDict);

const chunk1 = "Connecting to [IP_1] with pass";
const chunk2 = "word [SECRET_1]. Key is [AW";
const chunk3 = "S_KEY_1].";

console.log(sentinel.rehydrate(chunk1, sanitized.mappingDict));
console.log(sentinel.rehydrate(chunk2, sanitized.mappingDict));
console.log(sentinel.rehydrate(chunk3, sanitized.mappingDict));
