// export function errorHandler(error, req, res, next) {
//   if (res.headersSent) {
//     return next(error);
//   }

//   return res.status(error.statusCode || 502).json({
//     success: false,
//     message: error.message || 'Something went wrong'
//   });
// }

export function errorHandler(error, req, res, next) {
  console.error(
    `Error during ${req.method} ${req.originalUrl}`
  );

  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(error.statusCode || 502).json({
    success: false,
    message: error.message || 'Something went wrong'
  });
}

// The error handling middleware which catches errors propagated by
// next(error) and sends a consistent response to the client in case of error