// Plain module so server code and the client upload form can both import it.
export const EXAM_TYPES = ['midterm', 'endterm', 'quiz', 'other'] as const;
export type ExamType = (typeof EXAM_TYPES)[number];
