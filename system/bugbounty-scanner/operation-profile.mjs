import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OPERATION_PROFILE_PATH = path.join(__dirname, 'operation-profile.json');

export function validateOperationProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('operation profile precisa ser objeto JSON');
  if (value.schemaVersion !== 1) throw new Error('operation profile schemaVersion não suportada');
  if (value.primaryRuntime !== 'github_actions') throw new Error('primaryRuntime precisa ser github_actions neste perfil');
  if (value.cloudSchedulesRequired !== true) throw new Error('cloudSchedulesRequired precisa ser true');
  if (!value.local || value.local.automaticStart !== false || value.local.requiredForOperation !== false
      || value.local.mode !== 'manual_only') {
    throw new Error('perfil local precisa ser manual_only, sem automaticStart e sem ser requisito operacional');
  }
  return Object.freeze({
    schemaVersion: 1,
    primaryRuntime: 'github_actions',
    cloudSchedulesRequired: true,
    local: Object.freeze({ automaticStart: false, requiredForOperation: false, mode: 'manual_only' }),
  });
}

export function loadOperationProfile(profilePath = DEFAULT_OPERATION_PROFILE_PATH) {
  try {
    return validateOperationProfile(JSON.parse(readFileSync(profilePath, 'utf8')));
  } catch (error) {
    throw new Error(`operation profile inválido em ${profilePath}: ${error.message}`);
  }
}
