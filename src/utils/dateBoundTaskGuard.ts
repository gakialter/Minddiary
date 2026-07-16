export const STALE_DATE_TASK_CREATION_ERROR = 'The current local date changed before task creation'

export function assertTaskCreationDateIsCurrent(
  expectedCurrentDate: string,
  currentDate: string,
): void {
  if (currentDate !== expectedCurrentDate) {
    throw new Error(STALE_DATE_TASK_CREATION_ERROR)
  }
}
