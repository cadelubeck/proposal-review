const assert = require('node:assert/strict')
const { strictnessWinner, evaluate, buildMatrix } = require('./compliance')

const rule = (value, comparison = 'max', unit = 'in') => ({
  valueType: 'number', value, comparison, unit, category: 'roadway',
  subject: 'road base depth', description: 'Minimum road base depth'
})

assert.equal(strictnessWinner(rule(8), rule(12)).value, 12)
assert.equal(strictnessWinner(rule(8), rule(6)).value, 8)
assert.equal(strictnessWinner(rule(2, 'min', '%'), rule(1.5, 'min', '%')).value, 1.5)
assert.equal(strictnessWinner(rule(8), rule(12, 'max', 'ft')), null)
assert.equal(evaluate(rule(10), rule(12)).result, 'fail')
assert.equal(evaluate(rule(12), rule(12)).result, 'pass')

const city = { id: 'city', title: 'City Standards', documentType: 'city_standard', requirements: [{ ...rule(8), documentId: 'city', page: 12, excerpt: '8 inches minimum' }] }
const geo = { id: 'geo', title: 'Geotechnical Report', documentType: 'geotechnical', requirements: [{ ...rule(12), documentId: 'geo', page: 7, excerpt: '12 inches minimum' }] }
const matrix = buildMatrix([rule(10)], [city, geo])
assert.equal(matrix[0].controllingValue, '12 in')
assert.equal(matrix[0].result, 'fail')
assert.equal(matrix[0].source.title, 'Geotechnical Report')

console.log('compliance rules: ok')
