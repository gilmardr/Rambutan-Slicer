/** Split seconds into whole hours/minutes and a seconds remainder. */
export function splitDurationSeconds(totalSeconds: number): {
  totalMinutes: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);

  return {
    totalMinutes,
    hours,
    minutes: totalMinutes % 60,
    seconds: totalSeconds % 60,
  };
}
