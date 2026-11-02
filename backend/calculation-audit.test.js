const assert = require('node:assert/strict')
const { auditCalculations, evaluateExpression, numericValue } = require('./calculation-audit')
const { applyCalculationAudits, buildMatrix } = require('./compliance')

assert.equal(evaluateExpression('(length * width) / 2', { length: 10, width: 4 }), 20)
assert.equal(evaluateExpression('-2^2 + 3', {}), -1)
assert.equal(numericValue('1,234.50'), 1234.5)
assert.equal(numericValue('1,23'), null)
assert.throws(() => evaluateExpression('process.exit()', {}), /unsupported symbol/)
assert.throws(() => evaluateExpression('length / 0', { length: 10 }), /divides by zero/)

const checks = auditCalculations([
  { subject: 'Printed arithmetic', expression: '5 + 3', inputs: [], reportedResult: '8' },
  {
    subject: 'Curb ramp slope',
    expression: '(rise / run) * 100',
    inputs: [{ name: 'rise', value: '6', unit: 'in', evidence: '6 in rise' }, { name: 'run', value: '72', unit: 'in', evidence: '72 in run' }],
    reportedResult: '8.3',
    unit: '%',
    evidence: 'Slope = 8.3%'
  },
  {
    subject: 'Road base depth',
    expression: 'depth + cover',
    inputs: [{ name: 'depth', value: 5 }, { name: 'cover', value: 3 }],
    reportedResult: 9
  },
  {
    subject: 'Drainage area',
    expression: 'area * factor',
    inputs: [{ name: 'area', value: null }, { name: 'factor', value: 2 }],
    reportedResult: 12
  },
  {
    subject: 'Unsupported formula',
    expression: 'sqrt(area)',
    inputs: [{ name: 'area', value: 16 }],
    reportedResult: 4
  }
])
assert.deepEqual(checks.map(check => check.status), ['verified', 'verified', 'mismatch', 'review', 'review'])
assert.ok(Math.abs(checks[1].calculatedValue - 8.333333333333333) < 1e-12)

const noRequirementsMatrix = buildMatrix([{ subject: 'Road base depth', value: 10, valueType: 'number', unit: 'in' }], [], checks)
assert.equal(noRequirementsMatrix[0].result, 'fail')
assert.match(noRequirementsMatrix[0].recommendedCorrection, /Correct the calculation/)

const previouslyPassingRow = { subject: 'Unsupported formula', result: 'pass', reason: 'Existing comparison' }
assert.equal(applyCalculationAudits([previouslyPassingRow], checks)[0].result, 'review')
const multipleChecks = applyCalculationAudits(
  [{ subject: 'Road base depth', result: 'pass', reason: 'Existing comparison' }],
  [{ subject: 'Road base depth', status: 'verified', reason: 'Matches' }, { subject: 'Road base depth', status: 'mismatch', reason: 'Differs' }]
)
assert.equal(multipleChecks[0].result, 'fail')
assert.equal(multipleChecks[0].calculationChecks.length, 2)

console.log('calculation audit: ok')
