export type SupportedLanguage = 'rust' | 'python' | 'c' | 'csharp' | 'java';

export interface RunResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

const TIMEOUT_MS = 15000;

function nodeModules() {
    // Dynamic require so mobile doesn't crash at import time
    try {
        return {
            fs: require('fs') as typeof import('fs'),
            path: require('path') as typeof import('path'),
            os: require('os') as typeof import('os'),
            exec: (require('child_process') as typeof import('child_process')).exec,
        };
    } catch {
        return null;
    }
}

function runShell(cmd: string, execFn: typeof import('child_process')['exec']): Promise<RunResult> {
    return new Promise(resolve => {
        execFn(cmd, { timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
            resolve({
                stdout: stdout || '',
                stderr: stderr || (err?.message ?? ''),
                exitCode: (err as any)?.code ?? 0,
            });
        });
    });
}

export async function runCode(language: SupportedLanguage, code: string): Promise<RunResult> {
    const mods = nodeModules();
    if (!mods) return { stdout: '', stderr: 'Code execution requires Obsidian desktop.', exitCode: 1 };

    const { fs, path, os, exec } = mods;
    const tmp = os.tmpdir();
    const ts = Date.now();

    switch (language) {
        case 'rust': {
            const src = path.join(tmp, `gi_${ts}.rs`);
            const bin = path.join(tmp, `gi_${ts}`);
            fs.writeFileSync(src, code, 'utf8');
            const compile = await runShell(`rustc "${src}" -o "${bin}"`, exec);
            if (compile.exitCode !== 0) {
                try { fs.unlinkSync(src); } catch { /* ignore */ }
                return { stdout: '', stderr: compile.stderr || compile.stdout, exitCode: compile.exitCode };
            }
            const result = await runShell(`"${bin}"`, exec);
            try { fs.unlinkSync(src); fs.unlinkSync(bin); } catch { /* ignore */ }
            return result;
        }

        case 'python': {
            const src = path.join(tmp, `gi_${ts}.py`);
            fs.writeFileSync(src, code, 'utf8');
            const result = await runShell(`python3 "${src}"`, exec);
            try { fs.unlinkSync(src); } catch { /* ignore */ }
            return result;
        }

        case 'c': {
            const src = path.join(tmp, `gi_${ts}.c`);
            const bin = path.join(tmp, `gi_${ts}`);
            fs.writeFileSync(src, code, 'utf8');
            const compile = await runShell(`gcc "${src}" -o "${bin}"`, exec);
            if (compile.exitCode !== 0) {
                try { fs.unlinkSync(src); } catch { /* ignore */ }
                return { stdout: '', stderr: compile.stderr || compile.stdout, exitCode: compile.exitCode };
            }
            const result = await runShell(`"${bin}"`, exec);
            try { fs.unlinkSync(src); fs.unlinkSync(bin); } catch { /* ignore */ }
            return result;
        }

        case 'csharp': {
            const src = path.join(tmp, `gi_${ts}.csx`);
            fs.writeFileSync(src, code, 'utf8');
            const result = await runShell(`dotnet script "${src}"`, exec);
            try { fs.unlinkSync(src); } catch { /* ignore */ }
            return result;
        }

        case 'java': {
            const dir = path.join(tmp, `gi_${ts}`);
            fs.mkdirSync(dir, { recursive: true });
            const src = path.join(dir, 'Main.java');
            fs.writeFileSync(src, code, 'utf8');
            const compile = await runShell(`javac "${src}"`, exec);
            if (compile.exitCode !== 0) {
                try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }
                return { stdout: '', stderr: compile.stderr || compile.stdout, exitCode: compile.exitCode };
            }
            const result = await runShell(`java -cp "${dir}" Main`, exec);
            try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }
            return result;
        }

        default:
            return { stdout: '', stderr: `Unsupported language: ${language}`, exitCode: 1 };
    }
}

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
    rust: 'Rust',
    python: 'Python',
    c: 'C',
    csharp: 'C#',
    java: 'Java',
};

export const TOOLCHAIN_HINTS: Record<SupportedLanguage, string> = {
    rust: 'Install Rust: https://rustup.rs',
    python: 'Install Python 3 from https://python.org',
    c: 'Install GCC (Linux/macOS: built-in; Windows: MinGW-w64)',
    csharp: 'Run: dotnet tool install -g dotnet-script',
    java: 'Install JDK from https://adoptium.net',
};
