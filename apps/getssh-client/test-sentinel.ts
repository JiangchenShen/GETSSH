import { app } from 'electron';
import { SentinelGateway } from './electron/main/services/SentinelGateway';

// Mock app methods since we are not in electron
(app as any) = {
  getAppPath: () => process.cwd()
};

const text = "Connect to my server at 192.168.1.50 using password='super_secret_pw' and AKIA1234567890ABCDEF";
console.log("Original:", text);

const sanitized = SentinelGateway.sanitize(text);
console.log("Sanitized:", sanitized.cleanText);
console.log("Mapping:", sanitized.mappingDict);

const rehydrator = SentinelGateway.createStreamRehydrator(sanitized.mappingDict);
console.log("Chunk 1:", rehydrator.processChunk("Here is the script for "));
console.log("Chunk 2:", rehydrator.processChunk("[IP_1] and your pas"));
console.log("Chunk 3:", rehydrator.processChunk("sword is [SECRET_1] and token is [A"));
console.log("Chunk 4:", rehydrator.processChunk("WS_KEY_1]. Done."));
console.log("Flush:", rehydrator.flush());
