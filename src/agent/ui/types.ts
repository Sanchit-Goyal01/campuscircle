export type TraceStep = {
  seq: number;
  kind: 'tool_call' | 'tool_result' | 'approval_requested' | 'error';
  tool_name: string | null;
  payload: unknown;
};

export type PendingAction = {
  id: string;
  tool_name: string;
  input: unknown;
  status: string;
};

/** Shown in place of the raw name of a tool, which still appears in the trace. */
export const humanizeToolName = (name: string) => {
  const words = name.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};
