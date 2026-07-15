'use strict';

function runDerivedCalculations(tasks) {
  if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks)) throw new TypeError('derived calculation tasks must be an object');
  const results = {};
  for (const [id, calculate] of Object.entries(tasks)) {
    try {
      if (typeof calculate !== 'function') throw new TypeError('calculation must be a function');
      results[id] = calculate();
    } catch (error) {
      results[id] = { status: 'error', value: null, errorType: 'calculation_failed', message: error.message };
    }
  }
  return results;
}

module.exports = { runDerivedCalculations };

