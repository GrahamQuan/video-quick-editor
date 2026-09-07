const US_PER_SECOND = 1_000_000;

export function parseTimeToUs(value: string): number {
  const input = value.trim();
  if (!input) throw new Error("时间不能为空");
  let seconds: number;
  if (input.includes(":")) {
    const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/u.exec(input);
    if (!match) throw new Error("时间格式应为 HH:MM:SS[.fraction]");
    const [, hoursText, minutesText, secondsText] = match;
    const minutes = Number(minutesText);
    const secondsPart = Number(secondsText);
    if (minutes >= 60 || secondsPart >= 60) throw new Error("分钟和秒必须小于 60");
    seconds = Number(hoursText) * 3600 + minutes * 60 + secondsPart;
  } else {
    seconds = Number(input);
  }
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("时间必须是非负有限数");
  const micros = Math.round(seconds * US_PER_SECOND);
  if (!Number.isSafeInteger(micros)) throw new Error("时间超出安全范围");
  return micros;
}

export function formatTime(us: number): string {
  if (!Number.isSafeInteger(us) || us < 0) throw new Error("时间必须是非负安全整数微秒");
  const hours = Math.floor(us / 3_600_000_000);
  const minutes = Math.floor((us % 3_600_000_000) / 60_000_000);
  const seconds = (us % 60_000_000) / US_PER_SECOND;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}

export function secondsArg(us: number): string {
  return (us / US_PER_SECOND).toFixed(6);
}

export function parseRational(value: string): { numerator: number; denominator: number } | null {
  const match = /^(\d+)\/(\d+)$/u.exec(value);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return denominator > 0 && numerator > 0 ? { numerator, denominator } : null;
}
