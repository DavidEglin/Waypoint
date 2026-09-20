import { z } from 'zod';

export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH, 'That password is too long.');

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Use at least 3 characters.')
  .max(40, 'Use 40 characters or fewer.')
  .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dots, dashes and underscores only.');

export const themeSchema = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof themeSchema>;

export const roleSchema = z.enum(['admin', 'user']);
export type Role = z.infer<typeof roleSchema>;

// ---- Session / current user ----

export const loginRequestSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const updateSettingsRequestSchema = z.object({ theme: themeSchema });
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

export interface CurrentUser {
  id: number;
  username: string;
  role: Role;
  theme: Theme;
  mustChangePassword: boolean;
}

// ---- Admin: users ----

export const createUserRequestSchema = z.object({
  username: usernameSchema,
  role: roleSchema.default('user'),
  temporaryPassword: passwordSchema,
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const resetPasswordRequestSchema = z.object({ temporaryPassword: passwordSchema });
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const updateUserRequestSchema = z.object({ active: z.boolean() });
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export interface AdminUser {
  id: number;
  username: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastSignIn: string | null;
}

// ---- Connections (Canvas + Claude) ----

export const connectionKindSchema = z.enum(['canvas', 'claude']);
export type ConnectionKind = z.infer<typeof connectionKindSchema>;

export const saveCanvasRequestSchema = z.object({
  baseUrl: z.string().trim().min(1).max(300),
  token: z.string().trim().min(1).max(500),
});
export type SaveCanvasRequest = z.infer<typeof saveCanvasRequestSchema>;

export const saveClaudeRequestSchema = z.object({
  apiKey: z.string().trim().min(1).max(500),
});
export type SaveClaudeRequest = z.infer<typeof saveClaudeRequestSchema>;

/** Outcome of the last connection test. Secrets are never part of any response. */
export type ConnectionStatus = 'untested' | 'ok' | 'failed';

export type ConnectionErrorCode =
  | 'bad_credentials'
  | 'rate_limited'
  | 'timeout'
  | 'unreachable'
  | 'bad_response'
  | 'unavailable'
  | 'invalid_address';

/** Plain-language text for each connection/read failure, shared so server and client say the same thing. */
export const CONNECTION_ERROR_TEXT: Record<ConnectionErrorCode, string> = {
  bad_credentials: 'That was rejected. Check the details and try again.',
  rate_limited: 'Too many requests just now. Wait a minute and try again.',
  timeout: 'It took too long to answer. Try again in a moment.',
  unreachable: 'Could not reach it. Check the address and your connection.',
  bad_response: 'It answered, but not in the way we expected. Check the address.',
  unavailable: 'The service is busy or down at the moment. Try again shortly.',
  invalid_address: 'That address does not look right.',
};

export interface ConnectionInfo {
  connected: boolean;
  status: ConnectionStatus;
  lastVerified: string | null;
  lastError: ConnectionErrorCode | null;
}

export interface CanvasConnectionInfo extends ConnectionInfo {
  baseUrl: string | null;
}

export interface ConnectionsResponse {
  canvas: CanvasConnectionInfo;
  claude: ConnectionInfo;
}

export interface ApiError {
  error: string;
  message: string;
}

// ---- Courses and assessments (M2) ----

export interface CourseInfo {
  id: number;
  canvasCourseId: string;
  code: string | null;
  name: string;
}

/** An upcoming assignment found in Canvas that the student can add. */
export interface CanvasFoundAssessment {
  courseId: number;
  courseName: string;
  canvasAssignmentId: string;
  name: string;
  dueAt: string | null;
  /** Set when this assignment has already been added. */
  addedAssessmentId: number | null;
}

export interface CanvasFoundResponse {
  courses: CourseInfo[];
  items: CanvasFoundAssessment[];
}

export const fromCanvasRequestSchema = z.object({
  courseId: z.number().int().positive(),
  canvasAssignmentId: z.string().trim().min(1).max(40).regex(/^\d+$/, 'Not a Canvas assignment id.'),
});
export type FromCanvasRequest = z.infer<typeof fromCanvasRequestSchema>;

export type AssessmentStatus = 'reading' | 'needs_check' | 'confirmed' | 'searching' | 'ready' | 'failed';
export type AssessmentSource = 'canvas' | 'photo' | 'document';
export type ReadMethod = 'vision' | 'parsed' | 'canvas';

/** Why reading a notification failed. Connection codes are reused where the cause is the same. */
export type ReadErrorCode =
  | ConnectionErrorCode
  | 'no_claude_key'
  | 'no_canvas'
  | 'unreadable'
  | 'no_text'
  | 'too_long'
  | 'refused'
  | 'bad_parse'
  | 'internal';

export const READ_ERROR_TEXT: Record<ReadErrorCode, string> = {
  ...CONNECTION_ERROR_TEXT,
  // When reading, these say what was involved, since the student is not looking at a settings form.
  bad_credentials: 'Your Claude API key or Canvas token was rejected. Check them in Settings, then try again.',
  rate_limited: 'Claude or Canvas is limiting requests right now. Wait a minute, then try again.',
  timeout: 'Claude or Canvas took too long to answer. Try again in a moment.',
  unreachable: 'Waypoint could not reach Claude or Canvas. Check your connection and try again.',
  bad_response: 'Claude or Canvas answered in a way Waypoint did not expect. Try again.',
  unavailable: 'Claude or Canvas is busy or down at the moment. Try again shortly.',
  no_claude_key: 'Add your Claude API key in Settings, then try again.',
  no_canvas: 'Connect Canvas in Settings, then try again.',
  unreadable: 'Waypoint could not open that file. Try a clearer photo, or a different copy of the document.',
  no_text: 'There was no readable text in that notification. Try a clearer photo or a different file.',
  too_long: 'That notification is longer than Waypoint can read in one go.',
  refused: 'Claude declined to read that. Try a different file or a clearer photo.',
  bad_parse: 'Claude read it, but the answer was not usable. Try again.',
  internal: 'Something went wrong on our side. Try again.',
};

export interface AssessmentSummary {
  id: number;
  title: string;
  courseName: string | null;
  source: AssessmentSource;
  status: AssessmentStatus;
  /** Earliest part due date that is still ahead, if any. */
  nextDueAt: string | null;
  /** Latest part due date, used to sort and dim past assessments. */
  lastDueAt: string | null;
  createdAt: string;
}

export interface AssessmentPart {
  label: string;
  description: string | null;
  dueAt: string | null;
  /** False when the notification gave a date but no time of day. */
  dueHasTime: boolean;
  /** The notification's own wording for the due date, e.g. "Wed 23 Sep, in class". */
  dueText: string | null;
}

export interface AssessmentTopic {
  text: string;
  kind: 'keyword' | 'skill';
}

export interface AssessmentDetail extends AssessmentSummary {
  weightingText: string | null;
  weightingPercent: number | null;
  aiUse: string | null;
  parts: AssessmentPart[];
  topics: AssessmentTopic[];
  needsOwnFocus: boolean;
  focusPrompt: string | null;
  chosenFocus: string | null;
  readMethod: ReadMethod | null;
  sourceFile: { name: string | null; mime: string; size: number } | null;
  errorCode: ReadErrorCode | null;
}

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Claude accepts images up to 5 MB, so photos are shrunk in the browser first. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
