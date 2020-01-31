'use strict';

const path = require('path');
const fs = require('fs-extra');
const {EventEmitter} = require('events');
const _ = require('lodash');
const glob = require('glob-extra');
const pMap = require('p-map');
const debug = require('debug')('hermione:screenshots-cleaner');
const filesize = require('filesize');
const inquirer = require('inquirer');
const parseConfig = require('./config');
const logger = require('./utils/logger');
const mocha = require('./utils/mocha');

module.exports = (hermione, opts = {}) => {
    const pluginConfig = parseConfig(opts);

    if (!pluginConfig.enabled) {
        return;
    }

    if (hermione.isWorker()) {
        subscribeOnWorkerEvents(hermione, opts);

        return;
    }

    hermione.on(hermione.events.CLI, (program) => {
        program
            .command('clean-screenshots')
            .description('clean unused screenshots')
            .action(async () => {
                try {
                    let screenPatterns = _.compact([].concat(opts.screenshotPaths));
                    subscribeOnMasterEvents(hermione, opts, screenPatterns);
                    opts.runCleanScreenshots = true;

                    await hermione.run();

                    screenPatterns = _.uniq(screenPatterns);
                    debug(`Try to find screen paths on file system by patterns:\n${screenPatterns.join('\n')}`);

                    const readRefPaths = await glob.expandPaths(screenPatterns, {formats: '.png'});

                    if (_.isEmpty(readRefPaths)) {
                        logger.error(`Screenshot paths not found on file system by patterns:\n${screenPatterns.join('\n')}`);
                        return;
                    }

                    debug(`Found screen paths on file system:\n${readRefPaths.join('\n')}`);

                    const unusedRefPaths = _.difference(readRefPaths, opts.usedRefPaths);
                    if (_.isEmpty(unusedRefPaths)) {
                        logger.log(`Unused screenshots not found by patterns: ${screenPatterns}`);
                        return;
                    }

                    debug(`Found unused screenshots:\n${unusedRefPaths.join('\n')}`);

                    const bytes = (await pMap(unusedRefPaths, (refPath) => fs.stat(refPath))).reduce((acc, {size}) => acc + size, 0);
                    logger.log(`Found ${unusedRefPaths.length} unused screenshots with total size ${filesize(bytes)}`);

                    const {show} = await inquirer.prompt([{
                        name: 'show',
                        type: 'confirm',
                        message: 'Show list of unused screenshosts?',
                        default: false
                    }]);

                    if (show) {
                        logger.log(`List of unused screenshots:\n${unusedRefPaths.join('\n')}`);
                    }

                    const {remove} = await inquirer.prompt([{
                        name: 'remove',
                        type: 'confirm',
                        message: 'Remove unused screenshots?',
                        default: false
                    }]);

                    if (!remove) {
                        logger.log('Deletion of unused screenshots was canceled');
                        return;
                    }

                    await pMap(unusedRefPaths, (refPath) => fs.unlink(refPath));
                    logger.log('Deletion of unused screenshots was succeeded');
                } catch (err) {
                    logger.error(err.stack || err);
                    process.exit(1);
                }
            });
    });
};

function subscribeOnMasterEvents(hermione, opts, screenPatterns) {
    hermione.on(hermione.events.AFTER_TESTS_READ, (collection) => {
        const screenDirFns = collection.getBrowsers().reduce((acc, browserId) => {
            const {screenshotsDir} = hermione.config.forBrowser(browserId);

            if (_.isFunction(screenshotsDir)) {
                return _.set(acc, browserId, screenshotsDir);
            }

            const pattern = genScreenPattern(path.resolve(process.cwd(), screenshotsDir));
            screenPatterns.push(pattern);

            return acc;
        }, {});

        collection.eachTest((test, browserId) => {
            if (screenDirFns[browserId]) {
                const pattern = genScreenPattern(screenDirFns[browserId](test));
                screenPatterns.push(pattern);
            }

            if (test.pending) {
                test.pending = false;
                test.silentSkip = false;
            }
        });
    });

    hermione.on(hermione.events.TEST_END, (test) => {
        const context = mocha.getTestContext(test);

        if (_.get(context, 'hermioneCtx.usedRefPaths')) {
            opts.usedRefPaths = (opts.usedRefPaths || []).concat(context.hermioneCtx.usedRefPaths);
        }
    });
}

function subscribeOnWorkerEvents(hermione, opts) {
    const reservedCommands = [].concat(Object.keys(EventEmitter.prototype), 'addCommand', 'assertView', 'executionContext');

    hermione.on(hermione.events.NEW_BROWSER, (browser, {browserId}) => {
        if (!opts.runCleanScreenshots) {
            return;
        }

        const proto = Object.getPrototypeOf(browser);
        const commandsList = _.reject(Object.keys(proto), (command) => reservedCommands.includes(command) || command.startsWith('_'));

        commandsList.forEach((commandName) => {
            browser.addCommand(commandName, async () => ({value: {}}), true);
        });

        const browserConfig = hermione.config.forBrowser(browserId);

        browser.addCommand('assertView', async (state) => {
            const test = mocha.getTestContext(browser.executionContext);
            const refPath = browserConfig.getScreenshotPath(test, state);
            test.hermioneCtx.usedRefPaths = (test.hermioneCtx.usedRefPaths || []).concat(refPath);
        }, true);
    });
}

function genScreenPattern(pattern) {
    return path.resolve(pattern, '**', '*.png');
}
