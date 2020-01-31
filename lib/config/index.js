'use strict';

const _ = require('lodash');
const {root, section, option} = require('gemini-configparser');
const defaults = require('./defaults');

const ENV_PREFIX = 'hermione_screenshots-cleaner';
const CLI_PREFIX = '--screenshots-cleaner-';

const assertType = (name, validationFn, type) => {
    return (value) => {
        if (!validationFn(value)) {
            throw new TypeError(`"${name}" option must be ${type}, but got ${typeof value}`);
        }
    };
};

const assertBoolean = (name) => assertType(name, _.isBoolean, 'boolean');
const assertStringOrArrayOfStrings = (value, name) => {
    if (!(_.isArray(value) && value.every(_.isString)) && !_.isString(value)) {
        throw new Error(`"${name}" option must be a string or an array of strings but got ${JSON.stringify(value)}`);
    }
};

const getParser = () => {
    return root(section({
        enabled: option({
            defaultValue: defaults.enabled,
            parseEnv: JSON.parse,
            parseCli: JSON.parse,
            validate: assertBoolean('enabled')
        }),
        screenshotPaths: option({
            defaultValue: defaults.screenshotPaths,
            parseEnv: JSON.parse,
            parseCli: JSON.parse,
            validate: (value) => {
                if (_.isNull(value)) {
                    return;
                }

                assertStringOrArrayOfStrings(value, 'screenshotPaths');
            }
        })
    }), {envPrefix: ENV_PREFIX, cliPrefix: CLI_PREFIX});
};

module.exports = (options) => {
    const {env, argv} = process;

    return getParser()({options, env, argv});
};
