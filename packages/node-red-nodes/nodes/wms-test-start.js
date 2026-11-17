'use strict';

/** Beginnt einen Test: `msg.test = { name, startedAt, steps: [] }`. Läuft der Test im Testframework, wird `msg.scenario` mitgeführt. */
module.exports = function (RED) {
  function WmsTestStartNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.on('input', (msg, send, done) => {
      const name = config.name || (msg.scenario && msg.scenario.id) || 'Test';
      msg.test = { name, runId: (msg.scenario && msg.scenario.runId) || `${Date.now()}`, startedAt: Date.now(), steps: [] };
      node.status({ fill: 'blue', shape: 'dot', text: name });
      send(msg);
      done();
    });
  }
  RED.nodes.registerType('wms-test-start', WmsTestStartNode);
};
