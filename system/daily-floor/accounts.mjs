// Ofertas reais de conta remunerada conhecidas (pesquisadas nesta missão,
// research/registry_round2_partial.md) — não há API pública para consultar
// isso ao vivo, então mantemos aqui com a data em que foi verificado.
// ATUALIZAR MANUALMENTE se a taxa mudar — nunca deixar isso ficar velho
// sem avisar (ver `staleWarningDays`).

export const KNOWN_ACCOUNTS = [
  {
    name: 'Nubank (conta remunerada padrão)',
    cdiMultiplier: 1.00,
    verifiedOn: '2026-08-23',
    source: 'https://blog.nubank.com.br/cdi-2026/',
    notes: 'Sem teto conhecido de saldo para 100% CDI.',
  },
  {
    name: 'Mercado Pago (padrão)',
    cdiMultiplier: 1.00,
    verifiedOn: '2026-08-23',
    source: 'https://www.mercadopago.com.br/blog/como-ativar-rendimento-105-do-cdi-conta-mercado-pago',
    notes: 'Sobe para 105% até R$20.000 trazendo >=R$1.000/mês em aportes.',
  },
  {
    name: 'Mercado Pago (105% CDI, condição de aporte mensal)',
    cdiMultiplier: 1.05,
    verifiedOn: '2026-08-23',
    source: 'https://www.mercadopago.com.br/blog/como-ativar-rendimento-105-do-cdi-conta-mercado-pago',
    notes: 'Teto de saldo R$20.000 para essa faixa; exige aporte mínimo mensal de R$1.000.',
  },
  {
    name: 'PicPay (após 30 dias de conta)',
    cdiMultiplier: 1.02,
    verifiedOn: '2026-08-23',
    source: 'https://tvfoco.uai.com.br/picpay-ou-nubank-qual-banco-digital-rende-mais-em-2026',
    notes: 'Fonte secundária — confirmar direto no app antes de decidir.',
  },
];

export const STALE_WARNING_DAYS = 30;

export function daysSinceVerified(account, today = new Date()) {
  const verified = new Date(account.verifiedOn + 'T00:00:00Z');
  return Math.floor((today - verified) / 86400000);
}

/** Marca contas cuja taxa foi verificada há mais de STALE_WARNING_DAYS. */
export function withStaleness(accounts, today = new Date()) {
  return accounts.map((a) => ({ ...a, staleDays: daysSinceVerified(a, today), stale: daysSinceVerified(a, today) > STALE_WARNING_DAYS }));
}
