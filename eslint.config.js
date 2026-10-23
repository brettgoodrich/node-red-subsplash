"use strict";

const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
    {
        ignores: ["node_modules/**", "coverage/**", "generated/**"]
    },
    js.configs.recommended,
    {
        files: ["lib/**/*.js", "nodes/**/*.js", "test/**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: globals.node
        },
        rules: {
            "no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^_"
            }],
            eqeqeq: ["error", "always"],
            "no-var": "error",
            "prefer-const": "error"
        }
    }
];
