// Validate searches before authentication.
const ALLOWED_PARAMETERS = new Set(['q', 'mode', 'limit']);

function invalidQuery(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

export function parseInstrumentSearchQuery(query) {
  if (query === null || typeof query !== 'object' || Array.isArray(query)) {
    throw invalidQuery('Provide instrument search query parameters');
  }

  for (const key of Object.keys(query)) {
    if (!ALLOWED_PARAMETERS.has(key)) {
      throw invalidQuery('Allowed query parameters: q, mode, limit');
    }
  }

  // Repeated parameters become arrays in Express and must not be coerced to text.
  if (typeof query.q !== 'string' || /[\u0000-\u001f\u007f]/.test(query.q)) {
    throw invalidQuery('Provide q as one symbol or company name without control characters');
  }

  const mode = query.mode === undefined ? 'symbol' : query.mode;
  if (mode !== 'symbol' && mode !== 'name') {
    throw invalidQuery('mode must be symbol or name');
  }

  // Preserve punctuation in symbols and spelling/case in company names.
  const trimmed = query.q.trim();
  const q = mode === 'symbol' ? trimmed.toUpperCase() : trimmed;
  if (q.length < 1 || q.length > 64) {
    throw invalidQuery('q must contain between 1 and 64 characters');
  }

  const rawLimit = query.limit === undefined ? '10' : query.limit;
  if (typeof rawLimit !== 'string' || !/^[1-9]\d*$/.test(rawLimit)) {
    throw invalidQuery('limit must be an integer between 1 and 20');
  }
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit > 20) {
    throw invalidQuery('limit must be an integer between 1 and 20');
  }

  return { q, mode, limit };
}
