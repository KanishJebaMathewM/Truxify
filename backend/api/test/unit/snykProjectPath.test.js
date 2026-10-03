import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveSnykProjectPath } from '../../../../snyk/projectPath.js';

const temporaryDirectories = [];

function createTemporaryRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'truxify-snyk-'));
    temporaryDirectories.push(root);
    return root;
}

afterEach(() => {
    while (temporaryDirectories.length > 0) {
        const directory = temporaryDirectories.pop();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('resolveSnykProjectPath', () => {
    it('allows the project root itself', () => {
        const root = createTemporaryRoot();

        expect(resolveSnykProjectPath('.', root)).toBe(fs.realpathSync.native(root));
    });

    it('allows an existing directory inside the project root', () => {
        const root = createTemporaryRoot();
        const project = path.join(root, 'project');
        fs.mkdirSync(project);

        expect(resolveSnykProjectPath('project', root)).toBe(fs.realpathSync.native(project));
    });

    it('rejects traversal outside the project root', () => {
        const root = createTemporaryRoot();
        const outside = createTemporaryRoot();

        expect(() => resolveSnykProjectPath('../', root)).toThrow('outside the allowed project root');
        expect(() => resolveSnykProjectPath(outside, root)).toThrow('outside the allowed project root');
    });

    it('rejects a symlink that resolves outside the project root', () => {
        const root = createTemporaryRoot();
        const outside = createTemporaryRoot();
        const link = path.join(root, 'link');

        fs.symlinkSync(outside, link, 'junction');

        expect(() => resolveSnykProjectPath('link', root)).toThrow('outside the allowed project root');
    });

    it('rejects a missing path', () => {
        const root = createTemporaryRoot();

        expect(() => resolveSnykProjectPath('missing', root)).toThrow('Invalid Snyk project path');
    });

    it('rejects a file instead of a directory', () => {
        const root = createTemporaryRoot();
        fs.writeFileSync(path.join(root, 'project.txt'), 'test');

        expect(() => resolveSnykProjectPath('project.txt', root)).toThrow('Invalid Snyk project path');
    });
});
