'use strict';

const {getTestContext} = require('lib/utils/mocha');

describe('mocha "getTestContext"', () => {
    const stubTestContext = ({fullTitle = 'default-title'} = {}) => ({
        fullTitle: sinon.stub().returns(fullTitle)
    });

    const stubHookContext = ({title = 'default-hook', currentTest = {}} = {}) => ({
        type: 'hook',
        title,
        ctx: {currentTest: stubTestContext(currentTest)}
    });

    it('should return test context for "before each" hook', () => {
        const hook = stubHookContext({title: '"before each" hook'});

        const testContext = getTestContext(hook);

        assert.deepEqual(testContext, hook.ctx.currentTest);
    });

    it('should return test context for test', () => {
        const test = stubTestContext({fullTitle: 'some-title'});

        const testContext = getTestContext(test);

        assert.deepEqual(testContext, test);
    });
});
