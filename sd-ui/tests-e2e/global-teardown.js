const { stop } = require("./stack");

module.exports = async () => {
  await stop();
};
