import fs from 'fs';
import path from 'path';

export function resolveSnykProjectPath(inputPath, allowedRoot = process.env.SNYK_PROJECT_ROOT || process.cwd()) {
    if (typeof inputPath !== 'string' || !inputPath.trim()) {
        throw new Error('Invalid Snyk project path');
    }

    let rootPath;
    let projectPath;

    try {
        rootPath = fs.realpathSync.native(path.resolve(allowedRoot));
        projectPath = fs.realpathSync.native(path.resolve(rootPath, inputPath));
    } catch {
        throw new Error('Invalid Snyk project path');
    }

    const relativePath = path.relative(rootPath, projectPath);
    const isOutsideRoot = relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath);

    if (isOutsideRoot) {
        throw new Error('Snyk project path is outside the allowed project root');
    }

    try {
        if (!fs.statSync(projectPath).isDirectory()) {
            throw new Error('Snyk project path must be a directory');
        }
    } catch {
        throw new Error('Invalid Snyk project path');
    }

    return projectPath;
}
