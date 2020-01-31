'use strict';

const parseConfig = require('lib/config');

describe('config', () => {
    describe('"enabled" option', () => {
        it('should throw error if options is not a boolean', () => {
            assert.throws(
                () => parseConfig({enabled: 'true'}),
                Error,
                '"enabled" option must be boolean, but got string'
            );
        });

        it('should be enabled by default', () => {
            const config = parseConfig({});

            assert.isTrue(config.enabled);
        });

        it('should set provided value', () => {
            const config = parseConfig({enabled: false});

            assert.isFalse(config.enabled);
        });
    });

    describe('"screenshotPaths" option', () => {
        describe('should throw error if option', () => {
            it('is not a string', () => {
                assert.throws(
                    () => parseConfig({screenshotPaths: 100500}), Error,
                    '"screenshotPaths" option must be a string or an array of strings but got 100500'
                );
            });

            it('is not an array of strings', () => {
                assert.throws(
                    () => parseConfig({screenshotPaths: [100500]}), Error,
                    '"screenshotPaths" option must be a string or an array of strings but got [100500]'
                );
            });
        });

        it(`should be set to null by default`, () => {
            const config = parseConfig({});

            assert.isNull(config.screenshotPaths);
        });

        it('should set provided value', () => {
            const config = parseConfig({screenshotPaths: '/some/glob/**'});

            assert.equal(config.screenshotPaths, '/some/glob/**');
        });
    });
});
