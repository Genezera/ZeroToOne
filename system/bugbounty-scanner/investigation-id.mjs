import { createHash } from 'node:crypto';

/** Stable across local/cloud databases without coordinating UUID creation. */
export function investigationIdFor(findingId) {
  if (!findingId || typeof findingId !== 'string') throw new Error('findingId é obrigatório para gerar correlationId');
  return `inv:v1:${createHash('sha256').update(findingId).digest('hex')}`;
}
