/**
 * Vercel serverless entry — all routes are handled by the Express app in ../index.js
 * @see https://vercel.com/docs/functions/serverless-functions/runtimes/node-js
 */
const app = require('../index.js');

module.exports = app;
