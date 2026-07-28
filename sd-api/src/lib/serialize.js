function isPlainObject(value) {
  return Boolean(value) && Object.prototype.toString.call(value) === "[object Object]";
}

function serializeMongoValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeMongoValue);
  }

  if (value && typeof value === "object" && value._bsontype === "ObjectId") {
    return value.toString();
  }

  if (isPlainObject(value)) {
    return Object.entries(value).reduce((accumulator, [key, nestedValue]) => {
      accumulator[key] = serializeMongoValue(nestedValue);
      return accumulator;
    }, {});
  }

  return value;
}

module.exports = {
  serializeMongoValue,
};
