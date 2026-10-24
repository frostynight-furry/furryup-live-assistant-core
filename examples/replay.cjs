'use strict';
require('./scenarios.cjs').replay().then(report => process.stdout.write(JSON.stringify(report, null, 2) + '\n'), () => { console.error('Replay failed'); process.exitCode = 1; });
