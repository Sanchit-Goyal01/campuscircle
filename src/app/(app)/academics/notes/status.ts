export const NOTE_STATUS_LABEL: Record<string, string> = {
  ready: "Ready",
  not_searchable: "Not searchable (scanned PDF)",
  processing: "Processing",
  failed: "Failed",
};

export const noteStatusLabel = (status: string) => NOTE_STATUS_LABEL[status] ?? "Processing";
