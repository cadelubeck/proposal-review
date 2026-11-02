function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const text = value.trim()
  const grouped = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)
  const normalized = grouped ? text.replaceAll(',', '') : text
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return null
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

function tokenize(expression) {
  if (typeof expression !== 'string' || expression.length > 500) {
    throw new Error('Calculation expression is missing or too long.')
  }
  const tokens = []
  const pattern = /\s*(?:((?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([()+\-*/^]))/iy
  let index = 0
  while (index < expression.length) {
    if (!expression.slice(index).trim()) break
    pattern.lastIndex = index
    const match = pattern.exec(expression)
    if (!match) throw new Error('Expression contains an unsupported symbol or operation.')
    tokens.push(match[1] ? { type: 'number', value: Number(match[1]) }
      : match[2] ? { type: 'name', value: match[2] }
        : { type: 'operator', value: match[3] })
    index = pattern.lastIndex
    if (tokens.length > 200) throw new Error('Calculation expression has too many operations.')
  }
  return tokens
}

function evaluateExpression(expression, inputs) {
  const tokens = tokenize(expression)
  if (!tokens.length) throw new Error('Calculation expression is empty.')
  let cursor = 0
  const peek = value => tokens[cursor]?.value === value
  const take = () => tokens[cursor++]

  function primary() {
    const token = take()
    if (!token) throw new Error('Calculation expression is incomplete.')
    if (token.type === 'number') return token.value
    if (token.type === 'name') {
      if (!Object.hasOwn(inputs, token.value)) throw new Error(`Calculation input "${token.value}" is missing.`)
      return inputs[token.value]
    }
    if (token.value === '(') {
      const value = addition()
      if (!peek(')')) throw new Error('Calculation expression has an unmatched parenthesis.')
      take()
      return value
    }
    throw new Error('Calculation expression is incomplete.')
  }

  function power() {
    const base = primary()
    if (!peek('^')) return base
    take()
    const exponent = unary()
    if (Math.abs(exponent) > 12) throw new Error('Exponent is outside the supported range.')
    return base ** exponent
  }

  function unary() {
    if (peek('+')) {
      take()
      return unary()
    }
    if (peek('-')) {
      take()
      return -unary()
    }
    return power()
  }

  function multiplication() {
    let value = unary()
    while (peek('*') || peek('/')) {
      const operator = take().value
      const right = unary()
      if (operator === '/' && right === 0) throw new Error('Calculation divides by zero.')
      value = operator === '*' ? value * right : value / right
    }
    return value
  }

  function addition() {
    let value = multiplication()
    while (peek('+') || peek('-')) {
      const operator = take().value
      const right = multiplication()
      value = operator === '+' ? value + right : value - right
    }
    return value
  }

  const value = addition()
  if (cursor !== tokens.length) throw new Error('Calculation expression contains unexpected trailing input.')
  if (!Number.isFinite(value) || Math.abs(value) > 1e15) throw new Error('Calculated result is outside the supported numeric range.')
  return value
}

function reportedTolerance(value) {
  const text = String(value).trim().replaceAll(',', '')
  const [mantissa, exponentText] = text.toLowerCase().split('e')
  const decimalPlaces = mantissa.includes('.') ? mantissa.split('.')[1].length : 0
  const exponent = exponentText ? Number(exponentText) : 0
  return Math.max(1e-12, 0.5 * (10 ** (exponent - decimalPlaces)))
}

function auditCalculations(calculations) {
  if (!Array.isArray(calculations)) return []
  return calculations.map((entry, index) => {
    const calculation = entry && typeof entry === 'object' ? entry : {}
    const result = {
      id: `calculation-${index + 1}`,
      subject: typeof calculation.subject === 'string' ? calculation.subject : 'Calculation',
      expression: typeof calculation.expression === 'string' ? calculation.expression : '',
      reportedValue: calculation.reportedResult ?? null,
      unit: calculation.unit ?? null,
      page: Number.isInteger(calculation.page) ? calculation.page : null,
      evidence: typeof calculation.evidence === 'string' ? calculation.evidence : '',
      status: 'review',
      calculatedValue: null,
      reason: '',
      unitReview: 'Numeric arithmetic is checked; units and engineering applicability still require professional verification.'
    }

    try {
      if (!Array.isArray(calculation.inputs) || calculation.inputs.length > 30) {
        throw new Error('Calculation operands exceed the supported limit.')
      }
      const inputs = Object.create(null)
      for (const input of calculation.inputs) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.name || '') || Object.hasOwn(inputs, input.name)) {
          throw new Error('Calculation input names are invalid or duplicated.')
        }
        const value = numericValue(input.value)
        if (value === null) throw new Error(`Calculation input "${input.name}" is not a finite number.`)
        inputs[input.name] = value
      }
      const calculatedValue = evaluateExpression(result.expression, inputs)
      result.calculatedValue = calculatedValue
      const reportedValue = numericValue(calculation.reportedResult)
      if (reportedValue === null) {
        result.reason = 'The document does not provide a numeric reported result to verify.'
        return result
      }
      const difference = Math.abs(calculatedValue - reportedValue)
      if (difference <= reportedTolerance(calculation.reportedResult)) {
        result.status = 'verified'
        result.reason = 'The reported arithmetic matches the independently calculated result within its displayed rounding precision.'
      } else {
        result.status = 'mismatch'
        result.reason = `The reported result differs from the independently calculated value (${calculatedValue}).`
      }
    } catch (error) {
      result.reason = error instanceof Error ? error.message : 'Calculation could not be evaluated.'
    }

    return result
  })
}

module.exports = { auditCalculations, evaluateExpression, numericValue }
