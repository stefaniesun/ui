const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/
const UNC_PATH = /^(?:\\\\|\/\/)/

export function isSafeProjectRelativePath(value: string): boolean {
  if (value.length === 0 || value.includes('\0')) return false
  if (value.startsWith('/') || WINDOWS_ABSOLUTE_PATH.test(value) || UNC_PATH.test(value)) return false

  const segments = value.replaceAll('\\', '/').split('/')
  return segments.every(segment => segment !== '..' && segment !== '' && segment !== '.')
}

export function toPlatformRelativePath(value: string): string {
  return value.replaceAll(/[\\/]+/g, '/')
}
