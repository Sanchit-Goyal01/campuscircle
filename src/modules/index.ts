import type { AgentTool } from '../agent/types';
import { createStudyPlan, getMarks } from './academics/tools';

export const allTools: AgentTool[] = [getMarks, createStudyPlan];
