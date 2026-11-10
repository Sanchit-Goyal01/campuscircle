import type { AgentTool } from '../agent/types';
import {
  createStudyPlan,
  getMarks,
  getPastPapers,
  getTimetable,
  getWeakSubjects,
  searchNotes,
} from './academics/tools';

export const allTools: AgentTool[] = [
  getMarks,
  createStudyPlan,
  getWeakSubjects,
  searchNotes,
  getPastPapers,
  getTimetable,
];
