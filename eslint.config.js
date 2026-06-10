const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    // Never lint dependencies, example flows, or coverage output
    {
        ignores: ['node_modules/**', 'examples/**', 'coverage/**']
    },

    js.configs.recommended,

    // Runtime + library code: CommonJS running under Node.js
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node
            }
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
        }
    },

    // Jest test files
    {
        files: ['__tests__/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.jest
            }
        }
    }
];
