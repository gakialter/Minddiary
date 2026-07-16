import type { NewStudyTask, StudyTask } from '../src/types'
import { assertTaskCreationDateIsCurrent } from '../src/utils/dateBoundTaskGuard'
import { validateDateKeyPayload, validateStudyTaskCreatePayload } from './ipcValidation'

type DateBoundTaskCreationDependencies = {
    getCurrentDateKey: () => string;
    createTask: (task: NewStudyTask) => StudyTask;
    runInTransaction: <T>(operation: () => T) => T;
};

export function createStudyTaskForCurrentDate(
    task: unknown,
    expectedCurrentDate: unknown,
    dependencies: DateBoundTaskCreationDependencies,
): StudyTask {
    const validatedTask = validateStudyTaskCreatePayload(task);
    const validatedExpectedDate = validateDateKeyPayload(expectedCurrentDate, 'expected current date');

    return dependencies.runInTransaction(() => {
        assertTaskCreationDateIsCurrent(validatedExpectedDate, dependencies.getCurrentDateKey());
        const createdTask = dependencies.createTask(validatedTask);
        assertTaskCreationDateIsCurrent(validatedExpectedDate, dependencies.getCurrentDateKey());
        return createdTask;
    });
}
