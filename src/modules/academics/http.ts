import { errorResponse } from '@/agent/api';
import { UploadError, type UploadErrorCode } from './ingest';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


const UPLOAD_ERRORS: Record<UploadErrorCode, { status: number; message: string }> = {
  not_pdf: { status: 415, message: 'Only PDF files are allowed.' },
  too_large: { status: 413, message: 'The file is larger than 20 MB.' },
  too_many_pages: { status: 422, message: 'The PDF has more than 300 pages.' },
};

/** A friendly response for an UploadError, or null for any other error. */
export function uploadErrorResponse(e: unknown): Response | null {
  if (!(e instanceof UploadError)) return null;
  const { status, message } = UPLOAD_ERRORS[e.code];
  return errorResponse(status, message);
}

export const badRequest = (message: string) => errorResponse(400, message);

/** The `file` part of a multipart body, or null when it is missing or empty. */
export function filePart(form: FormData): File | null {
  const file = form.get('file');
  return file instanceof File && file.size > 0 ? file : null;
}

export const textField = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
