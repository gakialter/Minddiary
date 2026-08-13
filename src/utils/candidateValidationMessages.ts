export type CandidateValidationReasonCode =
  | 'title_required'
  | 'title_too_long'
  | 'invalid_task_type'
  | 'estimate_must_be_integer'
  | 'estimate_out_of_range'
  | 'reason_required'
  | 'reason_too_long'
  | 'invalid_priority'
  | 'subject_unavailable'
  | 'entry_unavailable'
  | 'next_day_entry_not_allowed'
  | 'review_requires_due_mistake'
  | 'due_mistake_unavailable'
  | 'review_subject_mismatch'
  | 'mistake_requires_review_type'
  | 'duplicate_selected_title'
  | 'active_title_conflict'
  | 'duplicate_selected_mistake'
  | 'active_review_conflict'
  | 'selected_duration_exceeded'
  | 'unknown'

const INTERNAL_MESSAGE_TO_REASON_CODE: Readonly<Record<string, CandidateValidationReasonCode>> = {
  'title is required': 'title_required',
  'title must be 80 characters or fewer': 'title_too_long',
  'type is invalid': 'invalid_task_type',
  'estimate_minutes must be an integer number': 'estimate_must_be_integer',
  'estimate_minutes must be between 5 and 180': 'estimate_out_of_range',
  'reason is required': 'reason_required',
  'reason must be 240 characters or fewer': 'reason_too_long',
  'priority is invalid': 'invalid_priority',
  'subject_ref is not in the allowlist': 'subject_unavailable',
  'related_entry_ref is not in the allowlist': 'entry_unavailable',
  'related_entry_ref must be null for next-day candidates': 'next_day_entry_not_allowed',
  'review suggestions must reference a due mistake': 'review_requires_due_mistake',
  'review candidates must reference a due mistake': 'review_requires_due_mistake',
  'related_mistake_ref is not in the due-mistake allowlist': 'due_mistake_unavailable',
  'review suggestion subject must match the related mistake subject': 'review_subject_mismatch',
  'review candidate subject must match the related mistake subject': 'review_subject_mismatch',
  'non-review suggestions cannot reference a mistake': 'mistake_requires_review_type',
  'non-review candidates cannot reference a mistake': 'mistake_requires_review_type',
  'Duplicate title in selected suggestions': 'duplicate_selected_title',
  'Duplicate title in selected candidates': 'duplicate_selected_title',
  'An active task with this title already exists today': 'active_title_conflict',
  'An active task with this title already exists on the candidate date': 'active_title_conflict',
  'Duplicate related mistake in selected suggestions': 'duplicate_selected_mistake',
  'Duplicate related mistake in selected candidates': 'duplicate_selected_mistake',
  'An active review task for this mistake already exists today': 'active_review_conflict',
  'An active review task for this mistake already exists on the candidate date': 'active_review_conflict',
  'Selected suggestions exceed remaining available minutes': 'selected_duration_exceeded',
  'Selected candidates exceed remaining available minutes': 'selected_duration_exceeded',
}

const USER_MESSAGE_BY_REASON_CODE: Readonly<Record<CandidateValidationReasonCode, string>> = {
  title_required: '这个建议缺少任务标题，请补充后再试。',
  title_too_long: '这个建议的任务标题过长，请缩短到 80 个字符以内。',
  invalid_task_type: '这个建议的任务类型无法识别，请调整后再试。',
  estimate_must_be_integer: '预计用时需要填写整数分钟，请调整后再试。',
  estimate_out_of_range: '预计用时应在 5 到 180 分钟之间，请调整后再试。',
  reason_required: '这个建议缺少说明理由，请补充后再试。',
  reason_too_long: '这个建议的说明理由过长，请缩短后再试。',
  invalid_priority: '这个建议的优先级无法识别，请重新选择。',
  subject_unavailable: '关联科目当前不可用，请重新选择科目或取消关联。',
  entry_unavailable: '关联的今日日记当前不可用，请重新选择或取消关联。',
  next_day_entry_not_allowed: '次日任务不能关联今日日记，请取消日记关联。',
  review_requires_due_mistake: '这个复习建议没有关联到当前可复习的错题，请修改任务类型或重新生成。',
  due_mistake_unavailable: '关联的错题当前不在可复习范围内，请重新选择或取消关联。',
  review_subject_mismatch: '复习建议的科目与所选错题不一致，请重新选择。',
  mistake_requires_review_type: '只有复习类型才能关联错题，请修改任务类型或取消关联。',
  duplicate_selected_title: '选中的建议中有重复标题，请修改标题或取消重复选择。',
  active_title_conflict: '计划日期已有同名进行中任务，请修改标题或不选择此建议。',
  duplicate_selected_mistake: '多个选中建议关联了同一道错题，请只保留一个。',
  active_review_conflict: '这道错题在计划日期已有复习任务，请取消关联或不选择此建议。',
  selected_duration_exceeded: '选中建议的预计总时长超过剩余可用时间，请缩短用时或减少选择。',
  unknown: '这个建议暂时无法使用，请修改后重试或重新生成。',
}

export function toCandidateValidationReasonCode(
  internalMessage: string,
): CandidateValidationReasonCode {
  return INTERNAL_MESSAGE_TO_REASON_CODE[internalMessage] ?? 'unknown'
}

export function formatCandidateValidationMessage(internalMessage: string): string {
  return USER_MESSAGE_BY_REASON_CODE[toCandidateValidationReasonCode(internalMessage)]
}
