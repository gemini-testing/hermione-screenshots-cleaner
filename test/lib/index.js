'use strict';

const {AsyncEmitter} = require('gemini-core').events;
const fs = require('fs-extra');
const glob = require('glob-extra');
const inquirer = require('inquirer');
const proxyquire = require('proxyquire');
const logger = require('lib/utils/logger');
const mocha = require('lib/utils/mocha');

describe('plugin', () => {
    let plugin, debug, filesize;

    const _mkHermione = (opts = {}) => {
        opts = {proc: 'master', browsers: {}, ...opts};

        const hermione = new AsyncEmitter();
        hermione.isWorker = sinon.stub().returns(opts.proc === 'worker');
        hermione.events = {
            CLI: 'cli',
            AFTER_TESTS_READ: 'afterTestsRead',
            TEST_END: 'testEnd',
            NEW_BROWSER: 'newBrowser'
        };
        hermione.config = {
            forBrowser: (id) => opts.browsers[id] || {screenshotsDir: '/deafult-dir'}
        };
        hermione.run = sinon.stub().resolves();

        return hermione;
    };

    const _mkTest = (test = {hermioneCtx: {}}) => test;

    const _mkCliTool = () => {
        return {
            command: sinon.stub().returnsThis(),
            description: sinon.stub().returnsThis(),
            action: sinon.stub()
        };
    };

    const _runCleanScreenshots = async ({hermione = _mkHermione(), cliTool = _mkCliTool(), opts = {}} = {}) => {
        plugin(hermione, opts);
        hermione.emit(hermione.events.CLI, cliTool);

        const actionFn = cliTool.action.lastCall.args[0];

        await actionFn();
    };

    const _mkTestCollection = ({tests = [], browsers = ['default-browser']}) => {
        return {
            getBrowsers: () => browsers,
            eachTest: (cb) => tests.forEach((test) => {
                browsers.forEach((bro) => cb(test, bro));
            })
        };
    };

    const emitAfterTestsRead = ({hermione, tests, browsers}) => {
        const collection = _mkTestCollection({tests, browsers});
        hermione.emit(hermione.events.AFTER_TESTS_READ, collection);
    };

    beforeEach(() => {
        debug = sinon.stub();
        filesize = sinon.stub();
        plugin = proxyquire('lib', {debug: () => debug, filesize});

        sinon.stub(process, 'cwd').returns('/def/path');
        sinon.stub(process, 'exit');
        sinon.stub(logger, 'log');
        sinon.stub(logger, 'error');
        sinon.stub(mocha, 'getTestContext').returnsArg(0);
        sinon.stub(fs, 'stat').resolves({size: 0});
        sinon.stub(fs, 'unlink').resolves();
        sinon.stub(glob, 'expandPaths').resolves();
        sinon.stub(inquirer, 'prompt').resolves();
    });

    afterEach(() => sinon.restore());

    it('should do nothing if plugin is disabled', () => {
        const hermione = _mkHermione();
        sinon.spy(hermione, 'on');

        plugin(hermione, {enabled: false});

        assert.notCalled(hermione.on);
    });

    describe('"CLI" event', () => {
        describe('in worker process', () => {
            it('should do nothing', () => {
                const hermione = _mkHermione({proc: 'worker'});
                sinon.spy(hermione, 'on');

                plugin(hermione);

                assert.neverCalledWith(hermione.on, hermione.events.CLI);
            });
        });

        describe('in master process', () => {
            let hermione;

            beforeEach(() => {
                hermione = _mkHermione({proc: 'master'});
            });

            it('should register "clean-screenshots" command on "CLI" event', async () => {
                const cliTool = _mkCliTool();

                await _runCleanScreenshots({hermione, cliTool});

                assert.calledOnceWith(cliTool.command, 'clean-screenshots');
            });

            it('should set "runCleanScreenshots" field in plugin options', async () => {
                const opts = {};

                await _runCleanScreenshots({hermione, opts});

                assert.isTrue(opts.runCleanScreenshots);
            });

            it('should run hermione through API', async () => {
                await _runCleanScreenshots({hermione});

                assert.calledOnceWith(hermione.run);
            });

            it('should log an error stack on reject', async () => {
                hermione.run.rejects({stack: 'some-stack-error'});

                await _runCleanScreenshots({hermione});

                assert.calledOnceWith(logger.error, 'some-stack-error');
            });

            it('should exit with code 1 on reject', async () => {
                hermione.run.rejects({stack: 'some-stack-error'});

                await _runCleanScreenshots({hermione});

                assert.calledOnceWith(process.exit, 1);
            });

            describe('should find screen paths on file system', () => {
                it('by paths specified in "screenshotPaths" option', async () => {
                    const screenshotPaths = ['/screens/path1/**', '/screens/path2/**'];

                    await _runCleanScreenshots({hermione, opts: {screenshotPaths}});

                    assert.calledOnceWith(glob.expandPaths, screenshotPaths, {formats: '.png'});
                });

                it('by uniq paths specified in "screenshotPaths" option and generated on reading tests', async () => {
                    process.cwd.returns('/dir');
                    const screenshotPaths = ['/screens/path1/**', '/dir/yabro1/screens/**/*.png'];
                    const browsers = {
                        yabro1: {screenshotsDir: 'yabro1/screens'},
                        yabro2: {screenshotsDir: 'yabro2/screens'}
                    };
                    hermione = _mkHermione({proc: 'master', browsers});

                    const promise = _runCleanScreenshots({hermione, browsers, opts: {screenshotPaths}});
                    emitAfterTestsRead({hermione, browsers: ['yabro1', 'yabro2']});
                    await promise;

                    assert.calledOnceWith(
                        glob.expandPaths,
                        ['/screens/path1/**', '/dir/yabro1/screens/**/*.png', '/dir/yabro2/screens/**/*.png'],
                        {formats: '.png'});
                });
            });

            describe('debug info', () => {
                let screenshotPaths, readScreenPaths;

                beforeEach(async () => {
                    screenshotPaths = ['/screens/**'];
                    readScreenPaths = ['/screens/plain.png', '/screens/hover.png'];
                    glob.expandPaths.withArgs(screenshotPaths, {formats: '.png'}).resolves(readScreenPaths);

                    await _runCleanScreenshots({hermione, opts: {screenshotPaths}});
                });

                it('should log screen patterns by which screen paths are searched', () => {
                    assert.calledWith(debug, 'Try to find screen paths on file system by patterns:\n/screens/**');
                });

                it('should log screen paths found on file system', () => {
                    assert.calledWith(debug, 'Found screen paths on file system:\n/screens/plain.png\n/screens/hover.png');
                });

                it('should log list of found unused screenshots', () => {
                    assert.calledWith(debug, 'Found unused screenshots:\n/screens/plain.png\n/screens/hover.png');
                });
            });

            it('should log that screen paths not found on file system', async () => {
                const screenshotPaths = ['/screens/**'];
                glob.expandPaths.withArgs(screenshotPaths, {formats: '.png'}).resolves([]);

                await _runCleanScreenshots({hermione, opts: {screenshotPaths}});

                assert.calledWithMatch(logger.error, 'Screenshot paths not found on file system by patterns:\n/screens/**');
                assert.notCalled(fs.stat);
            });

            it('should log that no unused screens are found', async () => {
                const screenshotPaths = ['/screens/**'];
                const readScreenPaths = ['/screens/plain.png'];
                glob.expandPaths.withArgs(screenshotPaths, {formats: '.png'}).resolves(readScreenPaths);

                const test = _mkTest({
                    hermioneCtx: {
                        usedRefPaths: ['/screens/plain.png']
                    }
                });

                const promise = _runCleanScreenshots({hermione, opts: {screenshotPaths}});
                hermione.emit(hermione.events.TEST_END, test);
                await promise;

                assert.calledWith(logger.log, 'Unused screenshots not found by patterns: /screens/**');
                assert.notCalled(fs.stat);
            });

            it('should calc total size of unused screenshots', async () => {
                const screenshotPaths = ['/screens/**'];
                const readScreenPaths = ['/screens/plain.png', '/screens/hover.png'];
                glob.expandPaths.withArgs(screenshotPaths, {formats: '.png'}).resolves(readScreenPaths);
                fs.stat.withArgs('/screens/plain.png').resolves({size: 100});
                fs.stat.withArgs('/screens/hover.png').resolves({size: 200});
                filesize.returns('300 kB');

                await _runCleanScreenshots({hermione, opts: {screenshotPaths}});

                assert.calledWith(logger.log, `Found 2 unused screenshots with total size 300 kB`);
            });

            describe('ask questions to user', () => {
                it('should not show list of unused screenshots if user refused', async () => {
                    glob.expandPaths.resolves(['/screens/plain.png']);
                    inquirer.prompt.onFirstCall().resolves({show: false});

                    await _runCleanScreenshots({hermione});

                    assert.neverCalledWith(logger.log, 'List of unused screenshots:\n/screens/plain.png');
                });

                it('should show list of unused screenshots if user confirmed', async () => {
                    glob.expandPaths.resolves(['/screens/plain.png']);
                    inquirer.prompt.onFirstCall().resolves({show: true});

                    await _runCleanScreenshots({hermione});

                    assert.calledWith(logger.log, 'List of unused screenshots:\n/screens/plain.png');
                });

                it('should not remove unused screenshots if user refused', async () => {
                    glob.expandPaths.resolves(['/screens/plain.png']);
                    inquirer.prompt
                        .onFirstCall().resolves({show: false})
                        .onSecondCall().resolves({remove: false});

                    await _runCleanScreenshots({hermione});

                    assert.notCalled(fs.unlink);
                    assert.calledWith(logger.log, 'Deletion of unused screenshots was canceled');
                });

                it('should remove unused screenshots if user confirmed', async () => {
                    glob.expandPaths.resolves(['/screens/plain.png']);
                    inquirer.prompt
                        .onFirstCall().resolves({show: false})
                        .onSecondCall().resolves({remove: true});

                    await _runCleanScreenshots({hermione});

                    assert.calledOnceWith(fs.unlink, '/screens/plain.png');
                    assert.calledWith(logger.log, 'Deletion of unused screenshots was succeeded');
                });
            });
        });
    });

    describe('"AFTER_TESTS_READ" event', () => {
        describe('in worker process', () => {
            it('should do nothing', async () => {
                const hermione = _mkHermione({proc: 'worker'});
                sinon.spy(hermione, 'on');

                plugin(hermione);

                assert.neverCalledWith(hermione.on, hermione.events.AFTER_TESTS_READ);
            });
        });

        describe('in master process', () => {
            let hermione;

            beforeEach(() => {
                hermione = _mkHermione({proc: 'master'});
            });

            it('should not subscribe if "clean-screenshots" is not called', () => {
                sinon.spy(hermione, 'on');

                plugin(hermione);

                assert.neverCalledWith(hermione.on, hermione.events.AFTER_TESTS_READ);
            });

            it('should subscribe if "clean-screenshots" is called', async () => {
                sinon.spy(hermione, 'on');

                await _runCleanScreenshots({hermione});

                assert.calledWith(hermione.on, hermione.events.AFTER_TESTS_READ);
            });

            it('should generate screenshot patterns for each browser if "screenshotsDir" set as string', async () => {
                process.cwd.returns('/dir');
                const browsers = {
                    yabro1: {screenshotsDir: 'yabro1/screens'},
                    yabro2: {screenshotsDir: 'yabro2/screens'}
                };
                hermione = _mkHermione({proc: 'master', browsers});

                const promise = _runCleanScreenshots({hermione, browsers});
                emitAfterTestsRead({hermione, browsers: ['yabro1', 'yabro2']});
                await promise;

                assert.calledOnceWith(
                    glob.expandPaths,
                    ['/dir/yabro1/screens/**/*.png', '/dir/yabro2/screens/**/*.png'],
                    {formats: '.png'}
                );
            });

            it('should generate screenshot patterns for each test if "screenshotsDir" set as function', async () => {
                const browsers = {yabro1: {screenshotsDir: (test) => `${test.file}/screens`}};
                const tests = [{file: '/dir/file1'}, {file: '/dir/file2'}];

                hermione = _mkHermione({proc: 'master', browsers});

                const promise = _runCleanScreenshots({hermione, browsers});
                emitAfterTestsRead({hermione, browsers: ['yabro1'], tests});
                await promise;

                assert.calledOnceWith(
                    glob.expandPaths,
                    ['/dir/file1/screens/**/*.png', '/dir/file2/screens/**/*.png'],
                    {formats: '.png'}
                );
            });

            it('should enable skipped tests', async () => {
                const test = {pending: true};

                await _runCleanScreenshots({hermione});
                emitAfterTestsRead({hermione, tests: [test]});

                assert.propertyVal(test, 'pending', false);
                assert.propertyVal(test, 'silentSkip', false);
            });

            it('should not enable disabled tests', async () => {
                const test = {disabled: true};

                await _runCleanScreenshots({hermione});
                emitAfterTestsRead({hermione, tests: [test]});

                assert.propertyVal(test, 'disabled', true);
            });
        });
    });

    describe('"TEST_END" event', () => {
        describe('in worker process', () => {
            it('should do nothing', () => {
                const hermione = _mkHermione({proc: 'worker'});
                sinon.spy(hermione, 'on');

                plugin(hermione);

                assert.neverCalledWith(hermione.on, hermione.events.TEST_END);
            });
        });

        describe('in master process', () => {
            let hermione;

            beforeEach(() => {
                hermione = _mkHermione({proc: 'master'});
            });

            it('should not subscribe if "clean-screenshots" is not called', () => {
                sinon.spy(hermione, 'on');

                plugin(hermione);

                assert.neverCalledWith(hermione.on, hermione.events.TEST_END);
            });

            it('should subscribe if "clean-screenshots" is called', async () => {
                sinon.spy(hermione, 'on');

                await _runCleanScreenshots({hermione});

                assert.calledWith(hermione.on, hermione.events.TEST_END);
            });

            it('should get context of test', async () => {
                const test = _mkTest();

                await _runCleanScreenshots({hermione});
                hermione.emit(hermione.events.TEST_END, test);

                assert.calledOnceWith(mocha.getTestContext, test);
            });

            it('should not register reference paths if theirs does not found in test', async () => {
                const opts = {};
                const test = _mkTest();

                await _runCleanScreenshots({hermione, opts});
                hermione.emit(hermione.events.TEST_END, test);

                assert.isUndefined(opts.usedRefPaths);
            });

            it('should register reference paths if theirs found in test', async () => {
                const opts = {};
                const test = _mkTest({
                    hermioneCtx: {
                        usedRefPaths: ['/ref/path/1', '/ref/path/2']
                    }
                });

                await _runCleanScreenshots({hermione, opts});
                hermione.emit(hermione.events.TEST_END, test);

                assert.deepEqual(opts.usedRefPaths, ['/ref/path/1', '/ref/path/2']);
            });

            it('should add reference paths of test to existing ones', async () => {
                const opts = {};
                const test = _mkTest({
                    hermioneCtx: {
                        usedRefPaths: ['/ref/path/2']
                    }
                });

                await _runCleanScreenshots({hermione, opts});
                opts.usedRefPaths = ['/ref/path/1'];
                hermione.emit(hermione.events.TEST_END, test);

                assert.deepEqual(opts.usedRefPaths, ['/ref/path/1', '/ref/path/2']);
            });
        });
    });

    describe('"NEW_BROWSER" event', () => {
        describe('in master process', () => {
            it('should do nothing', () => {
                const hermione = _mkHermione({proc: 'master'});
                sinon.spy(hermione, 'on');

                plugin(hermione);

                assert.neverCalledWith(hermione.on, hermione.events.NEW_BROWSER);
            });
        });

        describe('in worker process', () => {
            let hermione;

            const _mkBrowser = ({commands = []} = {}) => {
                function Browser() {}
                Browser.prototype = {};

                commands.forEach((command) => {
                    Browser.prototype[command] = sinon.stub().resolves();
                });

                Browser.prototype.executionContext = {default: 'context'};
                Browser.prototype.addCommand = sinon.stub().callsFake((name, command) => {
                    Browser.prototype[name] = command;
                    sinon.spy(Browser.prototype, name);
                });

                return new Browser();
            };

            const emitNewBrowser = async (browser = _mkBrowser(), opts = {browserId: 'yabro'}) => {
                const pluginOpts = {};

                plugin(hermione, pluginOpts);
                await _runCleanScreenshots({opts: pluginOpts});
                hermione.emit(hermione.events.NEW_BROWSER, browser, opts);
            };

            beforeEach(() => {
                hermione = _mkHermione({proc: 'worker'});
            });

            it('should subscribe even if "clean-screenshots" is not called', () => {
                sinon.spy(hermione, 'on');

                plugin(hermione);

                assert.calledWith(hermione.on, hermione.events.NEW_BROWSER);
            });

            it('should do nothing if "clean-screenshots" command is not called', () => {
                const opts = {};
                const browser = _mkBrowser();

                plugin(hermione, opts);
                hermione.emit(hermione.events.NEW_BROWSER, browser, {browserId: 'yabro'});

                assert.notCalled(browser.addCommand);
            });

            describe('should not stub', () => {
                it('event emitter commands', async () => {
                    const eventEmitterCommands = ['on', 'emit'];
                    const browser = _mkBrowser({commands: eventEmitterCommands});

                    await emitNewBrowser(browser);

                    assert.neverCalledWith(browser.addCommand, 'on');
                    assert.neverCalledWith(browser.addCommand, 'emit');
                });

                it('private properties', async () => {
                    const browser = _mkBrowser({commands: ['_private1', '_private2']});

                    await emitNewBrowser(browser);
                    hermione.emit(hermione.events.NEW_BROWSER, browser, {browserId: 'yabro'});

                    assert.neverCalledWith(browser.addCommand, '_private1');
                    assert.neverCalledWith(browser.addCommand, '_private2');
                });

                [
                    {command: 'executionContext', name: 'property'},
                    {command: 'addCommand', name: 'command'}
                ].forEach(({command, name}) => {
                    it(`"${command}" ${name}`, async () => {
                        const browser = _mkBrowser();

                        await emitNewBrowser(browser);

                        assert.neverCalledWith(browser.addCommand, command);
                    });
                });
            });

            it('should stub browser command', async () => {
                const browser = _mkBrowser({commands: ['broCommand']});

                await emitNewBrowser(browser);

                assert.calledWith(browser.addCommand, 'broCommand', sinon.match.func, true);
            });

            it('should return stubbed value on call of stubbed command', async () => {
                const browser = _mkBrowser({commands: ['broCommand']});

                await emitNewBrowser(browser);
                const result = await browser.broCommand();

                assert.deepEqual(result, {value: {}});
            });

            describe('"assertView" command', () => {
                let getScreenshotPath;

                beforeEach(() => {
                    getScreenshotPath = sinon.stub();
                });

                it('should stub only once', async () => {
                    const browser = _mkBrowser({commands: ['assertView']});

                    await emitNewBrowser(browser);

                    assert.calledOnceWith(browser.addCommand, 'assertView', sinon.match.func, true);
                });

                it('should get screenshot path of reference', async () => {
                    const browser = _mkBrowser();
                    const test = _mkTest();
                    mocha.getTestContext.withArgs(browser.executionContext).returns(test);

                    getScreenshotPath.withArgs(test, 'plain1').returns('/ref/path/1');
                    const browserConfig = {getScreenshotPath};
                    hermione = _mkHermione({proc: 'worker', browsers: {yabro: browserConfig}});

                    await emitNewBrowser(browser, {browserId: 'yabro'});
                    await browser.assertView('plain1');

                    assert.calledOnceWith(browserConfig.getScreenshotPath, test, 'plain1');
                });

                it('should add found screenshot paths to "hermioneCtx" of test', async () => {
                    const browser = _mkBrowser();
                    const test = _mkTest();
                    mocha.getTestContext.withArgs(browser.executionContext).returns(test);

                    getScreenshotPath.withArgs(test, 'plain1').returns('/ref/path/1');
                    getScreenshotPath.withArgs(test, 'plain2').returns('/ref/path/2');
                    const browserConfig = {getScreenshotPath};
                    hermione = _mkHermione({proc: 'worker', browsers: {yabro: browserConfig}});

                    await emitNewBrowser(browser, {browserId: 'yabro'});
                    await browser.assertView('plain1');
                    await browser.assertView('plain2');

                    assert.deepEqual(test.hermioneCtx.usedRefPaths, ['/ref/path/1', '/ref/path/2']);
                });
            });
        });
    });
});
