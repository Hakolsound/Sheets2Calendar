module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
  ],
  parserOptions: {
    ecmaVersion: 2018,
  },
  rules: {
    // Add this rule to disable the unused variable error
    "no-unused-vars": "off"
  },
};