'use strict';
const { getPath, resolve } = require('../lib/common.js');

const OPS = {
  eq: (a, b) => String(a) === String(b),
  neq: (a, b) => String(a) !== String(b),
  exists: (a) => a !== undefined && a !== null,
  notExists: (a) => a === undefined || a === null,
  contains: (a, b) => (Array.isArray(a) ? a.map(String).includes(String(b)) : String(a ?? '').includes(String(b))),
  gt: (a, b) => Number(a) > Number(b),
  lt: (a, b) => Number(a) < Number(b),
  length: (a, b) => Array.isArray(a) && a.length === Number(b),
};

/**
 * Prüft Felder der Nachricht, z. B. `statusCode` eq `201`, `payload.state` eq `STARTED`.
 * Das Ergebnis wird als Schritt in `msg.test.steps` notiert. Ausgang 1: bestanden, Ausgang 2: nicht bestanden.
 */
module.exports = function (RED) {
  function WmsAssertNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.on('input', (msg, send, done) => {
      const failures = [];
      for (const check of config.checks || []) {
        const op = OPS[check.op] ? check.op : 'eq';
        const actual = getPath(msg, check.path);
        const expected = resolve(RED, check.value, msg);
        if (!OPS[op](actual, expected)) failures.push(`${check.path} ${op}${expected === undefined ? '' : ` ${JSON.stringify(expected)}`}, ist ${JSON.stringify(actual)}`);
      }
      const passed = failures.length === 0;
      const name = config.name || 'Prüfung';
      msg.test = msg.test || { name: 'Test', startedAt: Date.now(), steps: [] };
      msg.test.steps.push({ name, passed, detail: passed ? `${(config.checks || []).length} Bedingung(en) erfüllt` : failures.join('; ') });
      node.status(passed ? { fill: 'green', shape: 'dot', text: 'bestanden' } : { fill: 'red', shape: 'dot', text: failures[0].slice(0, 40) });
      send(passed ? [msg, null] : [null, msg]);
      done();
    });
  }
  RED.nodes.registerType('wms-assert', WmsAssertNode);
};

module.exports.OPS = OPS;
