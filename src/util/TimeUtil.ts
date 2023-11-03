export class TimeUtil {
  static addMinutes(minutes: number, date: Date = new Date()): Date {
    date.setMinutes(date.getMinutes() + minutes)
    return date
  }

  static addSeconds(seconds: number, date: Date = new Date()): Date {
    date.setSeconds(date.getSeconds() + seconds)
    return date
  }

  static toMilliSeconds(minutes: number): number {
    return minutes * 60 * 1000
  }

  static toSeconds(milliseconds: number): number {
    return Math.floor(milliseconds / 1000)
  }

  static toMinutes(milliseconds: number): number {
    return Math.floor(this.toSeconds(milliseconds) / 60)
  }
}