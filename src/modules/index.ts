import type { AgentTool } from '../agent/types';
import {
  createStudyPlan,
  getMarks,
  getPastPapers,
  getTimetable,
  getWeakSubjects,
  searchNotes,
} from './academics/tools';
import { fileComplaint, getCampusStatus, getMyComplaints } from './issues/tools';

export const allTools: AgentTool[] = [
  getMarks,
  createStudyPlan,
  getWeakSubjects,
  searchNotes,
  getPastPapers,
  getTimetable,
  fileComplaint,
  getMyComplaints,
  getCampusStatus,
];
