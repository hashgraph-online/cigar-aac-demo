import { requireNode, installPython, doctor } from './runtime.mjs';
try {
  requireNode(); installPython(); doctor();
  console.log('CIGAR 0.14.0 ready: the native worker compiled and verified context.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
