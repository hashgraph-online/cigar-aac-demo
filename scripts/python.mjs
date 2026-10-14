import { command, python } from './runtime.mjs';
try { command(python(), process.argv.slice(2)); }
catch (error) { console.error(error.message + '\nRun npm run setup:cigar to prepare the Python environment.'); process.exitCode = 1; }
