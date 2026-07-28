const { ApiError } = require("../lib/api-error");

function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  const statusCode = error.statusCode || 500;
  const response = {
    error: error.message || "Internal server error.",
  };

  if (error.details) {
    response.details = error.details;
  }

  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json(response);
}

module.exports = {
  errorHandler,
  notFoundHandler,
};
