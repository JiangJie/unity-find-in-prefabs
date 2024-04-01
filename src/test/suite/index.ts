import * as path from 'node:path';
import * as Mocha from 'mocha';
import { glob } from 'glob';

export function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
    });

    const testsRoot = path.resolve(__dirname, '..');

    return glob('**/**.test.js', { cwd: testsRoot }).then((files) => {
        // Add files to the test suite
        files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

        return new Promise((c, e) => {
            // Run the mocha test
            mocha.run(failures => {
                if (failures > 0) {
                    e(new Error(`${ failures } tests failed.`));
                } else {
                    c();
                }
            });
        });
    });
}
