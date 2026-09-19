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
  | 'invalid_address';

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
