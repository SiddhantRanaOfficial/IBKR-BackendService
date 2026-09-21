export function errorHandler(error, req, res, next) {
  console.error(
    `Error during ${req.method} ${req.originalUrl}`
  );

  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  // This section of error handling tell's callers when a rate-limited/unavailable request can retry.
  if (
    (error.statusCode === 429 || error.statusCode === 503) &&
    Number.isSafeInteger(error.retryAfter) && error.retryAfter > 0
  ) {
    res.setHeader('Retry-After', String(error.retryAfter));
  }
  // STEP 4 — END Retry-After response header.

  return res.status(error.statusCode || 502).json({
    success: false,
    message: error.message || 'Something went wrong'
  });
}

// The error handling middleware which catches errors propagated by
// next(error) and sends a consistent response to the client in case of error
