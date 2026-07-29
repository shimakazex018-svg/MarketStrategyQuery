'use strict';

const path = require('node:path');
const { NaaimOfficialUpdater } = require('../../server/data-sources/naaim-official-updater');

new NaaimOfficialUpdater({ rootDir: path.resolve(__dirname, '../..') }).update({ trigger: 'scheduled_weekly' })
  .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch(() => { process.stderr.write('{"ok":false,"result":"source_unavailable"}\n'); process.exitCode = 2; });
