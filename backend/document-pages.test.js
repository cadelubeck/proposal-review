const assert = require('node:assert/strict')
const { splitTextPages } = require('./document-pages')

const explicit = splitTextPages('first page\fsecond page\fthird page')
assert.equal(explicit.length, 3)
assert.deepEqual(explicit.map(page => page.pageNumber), [1, 2, 3])
assert.equal(explicit[1].text, 'second page')

const estimated = splitTextPages('alpha\nbeta\ngamma', 10)
assert.equal(estimated.length, 2)
assert.equal(estimated[0].text, 'alpha\nbeta')
assert.equal(estimated[1].text, 'gamma')

assert.deepEqual(splitTextPages(''), [{ pageNumber: 1, text: '' }])
console.log('Document page batching: ok')
