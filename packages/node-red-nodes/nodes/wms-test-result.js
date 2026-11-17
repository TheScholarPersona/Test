'use strict';

/**
 * Schließt einen Test ab: `msg.test.passed` und `durationMs`. Ein Fehler aus
 * einem Aktions-Node (`msg.wmsError`) wird als fehlgeschlagener Schritt
 * übernommen. Läuft der Test im Testframework (`msg.scenario`), werden Schritte
 * und Ergebnis dorthin übertragen, damit ein `link out` („return“) antworten kann.
 */
module.exports = function (RED) {
  function WmsTestResultNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.on('input', (msg, send, done) => {
      const test = msg.test || { name: 'Test', startedAt: Date.now(), steps: [] };
      if (msg.wmsError && !test.steps.some((s) => s.passed === false)) {
        test.steps.push({ name: 'WMS-Aufruf', passed: false, detail: `${msg.wmsError.code}: ${msg.wmsError.message}` });
      }
      test.passed = test.steps.length > 0 && test.steps.every((s) => s.passed === true);
      test.durationMs = Date.now() - test.startedAt;
      const failed = test.steps.find((s) => !s.passed);
      if (msg.scenario) {
        msg.scenario.steps.push(...test.steps);
        msg.scenario.passed = test.passed;
        if (failed) msg.scenario.error = `${failed.name}: ${failed.detail}`;
      }
      node.status(test.passed ? { fill: 'green', shape: 'dot', text: `bestanden (${test.steps.length})` } : { fill: 'red', shape: 'dot', text: failed ? failed.name : 'keine Schritte' });
      send(msg);
      done();
    });
  }
  RED.nodes.registerType('wms-test-result', WmsTestResultNode);
};
