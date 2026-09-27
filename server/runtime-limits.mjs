// Invalid settings fail closed to the default instead of disabling limits.
export function runtimeLimit(name, fallback, maximum) {
  const value = Number(process.env[name])
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback
}
