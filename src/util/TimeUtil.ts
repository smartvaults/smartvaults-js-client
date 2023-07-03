export class TimeUtil {
  static addMinutes(minutes: number, date: Date = new Date()): Date {
    date.setMinutes(date.getMinutes() + minutes)
    return date
  }

  static addSeconds(seconds: number, date: Date = new Date()): Date {
    date.setSeconds(date.getSeconds() + seconds)
    return date
  }
}