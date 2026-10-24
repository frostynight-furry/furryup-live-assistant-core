'use strict';
const scenarios = require('./scenarios.cjs');
const run = process.argv.includes('--realtime') ? scenarios.replayRealtime : scenarios.replay;
run().then(report => process.stdout.write(JSON.stringify(report, null, 2) + '\n'), () => { console.error('Replay failed'); process.exitCode = 1; });
