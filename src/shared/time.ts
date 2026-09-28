function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function parts(value: string): { date: Date; offset: string } {
  const date = new Date(value);
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return {
    date,
    offset: `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`,
  };
}

export function localIsoTimestamp(value: string): string {
  const { date, offset } = parts(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${offset}`;
}

export function reportFilenameTimestamp(value: string): string {
  const { date, offset } = parts(value);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}${offset.replace(":", "")}`;
}
