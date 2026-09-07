/**
 * Shared helpers for invoking native platform tooling (osascript / PowerShell)
 * safely and with sensible timeouts. Kept intentionally small so the platform
 * implementations stay declarative.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ExecResult {
  stdout: string
  stderr: string
}

export interface ExecOptions {
  timeoutMs?: number
  /** Max stdout/stderr buffer (icons can be large base64 blobs). */
  maxBuffer?: number
}

/** Run an executable with arguments, resolving stdout/stderr as strings. */
export async function run(file: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const { stdout, stderr } = await execFileAsync(file, args, {
    timeout: opts.timeoutMs ?? 15000,
    maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
    windowsHide: true
  })
  return {
    stdout: stdout.toString(),
    stderr: stderr.toString()
  }
}

const LINE_SEP = String.fromCharCode(0x2028)
const PARA_SEP = String.fromCharCode(0x2029)

/**
 * Escape characters that are valid inside a JSON string but can terminate or
 * break a JavaScript source string when a JSON blob is inlined into a JXA
 * script (U+2028 / U+2029 line separators).
 */
export function safeJsonForSource(value: unknown): string {
  return JSON.stringify(value)
    .split(LINE_SEP)
    .join('\\u2028')
    .split(PARA_SEP)
    .join('\\u2029')
}

/** Execute a JavaScript-for-Automation (JXA) script on macOS. */
export async function runJxa(script: string, opts: ExecOptions = {}): Promise<string> {
  const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', script], opts)
  return stdout.trim()
}

/**
 * Execute a PowerShell script on Windows. Uses -NoProfile for speed and
 * -ExecutionPolicy Bypass so it runs regardless of machine policy.
 */
export async function runPowershell(script: string, opts: ExecOptions = {}): Promise<string> {
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    opts
  )
  return stdout.trim()
}

/** Parse JSON, returning a fallback on any error (native output can be noisy). */
export function parseJsonSafe<T>(text: string, fallback: T): T {
  const trimmed = text.trim()
  if (!trimmed) return fallback
  try {
    return JSON.parse(trimmed) as T
  } catch {
    // PowerShell sometimes emits a BOM or leading warning lines; try to find
    // the first JSON token.
    const start = trimmed.search(/[[{]/)
    if (start > 0) {
      try {
        return JSON.parse(trimmed.slice(start)) as T
      } catch {
        return fallback
      }
    }
    return fallback
  }
}
