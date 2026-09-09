# ⛔ NÃO ENVIAR — FALSO POSITIVO REFUTADO PELA ESPECIFICAÇÃO

Uma nova revisão independente em 2026-09-09 confirmou que a hipótese central
deste rascunho estava errada. A especificação oficial CIP-3/Icarus exige
explicitamente `data[31] &= 0b0001_1111` e depois
`data[31] |= 0b0100_0000`. Portanto, a máscara `0x1f` usada pelo SDK está
correta. A proposta anterior de trocar `0x1f` por `0x7f` é que viola a
especificação.

Fonte normativa: https://cips.cardano.org/cip/CIP-3/annex/Icarus

O PoC histórico abaixo somente demonstrou que alterar uma implementação correta
para outra incorreta muda as chaves e os endereços. Ele não comprovou uma
vulnerabilidade. O registro foi encerrado como `false_positive`; este conteúdo é
mantido apenas como trilha de auditoria e exemplo de por que divergência de saída
não substitui validação contra a especificação primária.

---

# Rascunho histórico refutado — não usar para submissão

Este relatório foi gerado por IA a partir de análise de código-fonte
público (e, quando aplicável, prova de conceito executada localmente
contra um fork — nunca contra o sistema real). **Não foi enviado a
nenhuma plataforma.** Antes de copiar/colar e enviar, confira:

- [ ] Escopo confirmado — o ativo afetado está no escopo do programa AGORA
      (escopo pode mudar; reconfirme na página do programa antes de enviar)
- [ ] Categoria confirmada — bate com uma categoria que o programa
      declara como elegível para recompensa (não é metadado/cosmético).
      **Atenção**: o scope snapshot local (`research/bugbounty/scope-snapshots/okg.json`)
      tem `categoriesEligible: []` — a lista granular de categorias não foi
      capturada (fonte é `bounty-targets-data`, um dataset comunitário, não
      a página oficial do HackerOne). Confirme a categoria exata (provável:
      "Cryptographic Weakness" / "Insecure Key Derivation") na página real
      antes de enviar.
- [ ] Evidência conferida — os trechos de código e a saída da prova de
      conceito (quando houver) realmente existem/rodaram como descrito
      (não foi paráfrase/alucinação)
- [ ] Anterioridade pública checada e registrada — issues/PRs, advisories e
      Hacktivity/busca web, com pelo menos duas formulações e timestamp.
      **PISTA FORTE ENCONTRADA, NÃO CONFIRMADA** — ver seção "Alerta:
      possível conhecimento prévio pela OKX" logo abaixo. Isso PRECISA
      ser resolvido por um humano com acesso de navegador antes de
      qualquer envio — pode reduzir a novidade deste achado a zero.
- [ ] Risco de duplicata aceito conscientemente — busca pública limpa significa
      `private_unknown`, nunca prova que não existe report privado anterior
- [ ] Impacto estruturado confirmado — atacante, vítima, fronteira de
      segurança, resultado observável e C/I/A sustentados pela PoC
      a este programa

---

## ⚠️ Alerta: possível conhecimento prévio pela OKX — CONFIRMADO POR LEITURA REAL, NÃO ENVIAR SEM DECISÃO HUMANA
**Atualização 2026-09-04 (Claude Code local, navegador real):** a rodada
anterior encontrou isso só por snippet indexado (`EGRESS_BLOCKED` no
ambiente cloud). Abri a página real agora
(`https://www.okx.com/en-us/help/okx-wallet-announcement-on-the-cardano-network-upgrade`)
e o texto completo é:

> Published on Jan 7, 2026. [...] To enhance the service experience and
> compatibility for Cardano, OKX Wallet will perform an **upgrade for
> derived Cardano addresses** on January 15, 2026. During the upgrade,
> all Cardano network-related functions will be temporarily suspended.
> To ensure your assets remain accessible after the upgrade, please
> transfer Cardano assets in your OKX Wallet to the first address under
> your seed phrase wallet before January 15. [...] If you are unable to
> complete the transfer in time, your assets will not be lost. Feel free
> to contact our customer support **for assistance to regain access to
> those assets after the upgrade**.

O commit único que introduziu `NewXPrvKeyFromEntropy` com o clamp errado
(`c0b7c8755766b8c5d61e15879a44fa0ecce21cf9`, "add cardano, starknet v3,
update ton") é de **09/01/2026 13:46 +0800** — só **6 dias** antes desse
anúncio. "Upgrade para endereços DERIVADOS" e o sintoma descrito
("pode precisar de suporte pra reganhar acesso aos ativos na mesma seed
phrase depois do upgrade") são exatamente o comportamento esperado de
uma mudança na fórmula de clamp/derivação — consistente com a OKX tendo
corrigido isso internamente em produção logo após o lançamento, sem
nunca corrigir este repositório público (`git log` confirma: nenhum
commit subsequente tocou `coins/cardano/crypto/key.go`).

**Isso ainda não é uma confirmação direta** — o anúncio nunca cita
"clamp", "CIP-3" nem bug de derivação explicitamente; é inferência por
timing + sintoma, forte mas circunstancial, não uma admissão. **Isso não
refuta o achado tecnicamente** — o código público continua com o clamp
errado hoje, reproduzível como descrito abaixo. Mas **derruba fortemente
a alegação de novidade**. Avaliação desta sessão: dado o padrão de
duplicatas já sofrido neste programa/pipeline, **não vale investir mais
esforço em prova de regressão/submissão deste achado como está framed**
(bug ainda ativo/desconhecido) — rebaixado de prioridade. Antes de
qualquer envio, um humano ainda precisa:
1. Se possível, testar se o app/extensão OKX Wallet ATUAL deriva
   endereços Cardano diferentes do que este código-fonte público
   produziria hoje para o mesmo mnemonic (evidência direta de que a
   produção já foi corrigida enquanto o repo público não).
2. Decidir se ainda vale a pena reportar — por exemplo, como "o
   código-fonte público continua com uma vulnerabilidade que a produção
   já mitigou", que é uma categoria de achado válida mas com framing
   bem diferente do original.

## Título
Clamp incorreto na derivação de chave-mestra Cardano (CIP-3/Icarus) em `okx/go-wallet-sdk` gera carteiras incompatíveis com todo o ecossistema Cardano em ~50% dos casos

## Programa / Plataforma
`OKG` via `HackerOne` — https://hackerone.com/okg

## Categoria / Severidade declarada
Categoria exata não confirmada contra a página oficial (ver aviso no
topo) — mapeia para "Cryptographic Weakness" / "Insecure Key Derivation"
no vocabulário padrão de categorias HackerOne. O asset específico
(`https://github.com/okx/go-wallet-sdk`, tipo `SOURCE_CODE`) está
listado como `eligibleForBounty: true`, `eligibleForSubmission: true`,
`maxSeverity: critical` no scope snapshot local
(`research/bugbounty/scope-snapshots/okg.json`, capturado 2026-09-02).

## Ativo afetado
- Repositório: `okx/go-wallet-sdk`
- Arquivo: `coins/cardano/crypto/key.go`
- Função: `NewXPrvKeyFromEntropy`
- Linha(s): 22–29
- Commit no momento da análise: `12fec6b0616347265efcc23bfc240c155da710eb`
  (HEAD do clone raso público em 2026-09-04; verificar SHA atual antes de
  enviar — o código pode ter mudado desde a varredura)

## Resumo
`NewXPrvKeyFromEntropy` implementa a derivação de chave-mestra Cardano
(BIP32-Ed25519, esquema CIP-3/Icarus) a partir de mnemonic/entropy, mas
aplica uma máscara de "clamping" errada no último byte da chave. Isso faz
com que, para aproximadamente metade de todos os mnemonics possíveis, a
chave-mestra — e portanto todo endereço derivado dela — seja diferente da
que qualquer outra carteira Cardano compatível com CIP-3 (Yoroi,
Daedalus, Eternl, Ledger, Trezor, cardano-cli, bibliotecas de referência)
calcularia a partir da mesma seed phrase. Isso quebra a garantia central
de portabilidade de carteiras HD e cria risco real de perda aparente de
fundos ou de envio de fundos para um endereço que o usuário acredita
estar sob seu controle em outra carteira.

## Cadeia de chamada confirmada
- `coins/cardano/crypto/key.go::NewXPrvKeyFromEntropy` (L22-29): ponto
  onde o clamp incorreto é aplicado, sobre a saída de
  `pbkdf2.Key([]byte(password), entropy, 4096, 96, sha512.New)`.
- `coins/cardano/crypto/derive.go::Derive` (lido por completo): confirma
  que a derivação HD subsequente (hardened/soft) opera só sobre
  kl/kr/chaincode já existentes via HMAC-SHA512 — não reaplica nenhum
  clamp equivalente, então o erro da chave-mestra se propaga inalterado
  por toda a árvore de derivação, para qualquer `path`.
- `coins/cardano/account.go::DerivePrvKey` / `NewAddressFromPrvKey` /
  `NewAddressFromPubKey` (lidos): fluxo real usado pelo SDK para ir de
  mnemonic → chave-mestra → chave derivada por path → endereço Cardano —
  confirma que não há nenhuma camada intermediária que corrija ou
  re-normalize o clamp.
- `coins/cardano/account_test.go::TestNewAddress` (lido): o vetor de
  teste oficial do próprio repositório usa um mnemonic cujo byte 31
  pré-clamp tem o bit 5 igual a zero — por coincidência, esse teste
  específico nunca teria como pegar o bug (qualquer mnemonic de teste
  tem só ~50% de chance de expor a divergência).

## Pré-requisitos
Nenhum privilégio especial — qualquer mnemonic BIP39 válido gerado
localmente. Toda a validação foi feita com clone público do repositório
e execução local (`go test`), sem tocar rede, conta ou fundo real.

## Passo a passo de reprodução
1. Clonar `okx/go-wallet-sdk` no commit acima.
2. Gerar (ou usar) um mnemonic BIP39 cujo byte 31 do PBKDF2 bruto
   (`pbkdf2.Key([]byte(""), entropy, 4096, 96, sha512.New)`, antes do
   clamp) tenha o bit 5 (`0x20`) igual a 1 — estatisticamente ~50% dos
   mnemonics; ex.: `"hurdle bar fit maximum wild wait tilt bicycle
   ritual easily own cliff perfect calm cry"`.
3. Derivar o endereço Cardano no path `m/1852'/1815'/0'/0/0` usando o
   código real do repositório (`DerivePrvKey` + `NewAddressFromPrvKey`).
4. Derivar o endereço para o mesmo mnemonic/path usando qualquer
   implementação CIP-3-correta (clamp `key[31] = (key[31] & 0x7f) |
   0x40`, ao invés de `0x1f`) — ex. aplicando um patch mínimo local no
   próprio `key.go` e recompilando.
5. Comparar os dois endereços.

## Resultado atual vs. esperado
- **Atual:** `key[31] = (key[31] & 0x1f) | 0x40` — além de limpar o bit
  mais alto (bit 7, correto), a máscara `0x1f` também zera
  incondicionalmente o bit 5 do byte 31 antes do OR com `0x40`. A
  especificação exige preservar o valor original desse bit vindo do
  PBKDF2-HMAC-SHA512.
- **Esperado:** `key[31] = (key[31] & 0x7f) | 0x40` (CIP-3/Icarus: limpar
  só o bit mais alto, setar o segundo bit mais alto, preservar os demais
  6 bits do byte 31).

## Evidência
```go
// coins/cardano/crypto/key.go:22-29
func NewXPrvKeyFromEntropy(entropy []byte, password string) XPrvKey {
	key := pbkdf2.Key([]byte(password), entropy, 4096, 96, sha512.New)
	key[0] &= 0xf8
	key[31] = (key[31] & 0x1f) | 0x40
	return key
}
```

Especificação CIP-3/Icarus (cardano-foundation/CIPs, CIP-0003/Icarus.md,
replicada em cardano-crypto.js e no cardano-crypto de referência em
Rust): "clearing the lowest 3 bits [byte 0], clearing the highest bit
[byte 31], and setting the second highest bit [byte 31]" — ou seja
`key[31] &= 0x7f; key[31] |= 0x40`, nunca `0x1f`.

## Prova de conceito executável
Testes Go reais escritos e executados localmente (`go test -run <nome>
-v`), contra o clone público do repositório, sem tocar rede/conta real:

- `TestClampBit5Prevalence` — gera 200 mnemonics BIP39 aleatórios
  válidos, computa `pbkdf2.Key([]byte(""), entropy, 4096, 96,
  sha512.New)` (chamada idêntica à do código real) e mede a taxa de
  `raw[31]&0x20 != 0` (bit 5 setado antes do clamp).
  **Saída real:** `bit5(byte31)=1 em 101/200 mnemonics (~50%).`
- `TestClampDivergingMnemonic` — roda o fluxo real do SDK
  (`DerivePrvKey` + `NewAddressFromPrvKey`, path `m/1852'/1815'/0'/0/0`,
  idêntico ao teste oficial `account_test.go::TestNewAddress`) para o
  mnemonic `"hurdle bar fit maximum wild wait tilt bicycle ritual easily
  own cliff perfect calm cry"`.
  **Saída real (código tal como está no repositório, máscara `0x1f`):**
  `addr1q9vflaq445k7hvmtacfv98h4s5qg5lzhflg6je6t6wklp567x2g2h2dt6dftda2s8sljzr0de44hpydkugf4mmzelsqs2y237t`
- `TestFixedClampSameMnemonic` — mesmo mnemonic/path, após aplicar um
  único patch local (`sed`) trocando a máscara `0x1f` → `0x7f` em
  `key.go` (a correção mínima para o clamp correto) e recompilar.
  **Saída real:**
  `addr1qyapj3mj06tj6akqmpc4t5ymu0d0lukkqcamwpfqwjmhdn8twmk6n7wv759hw2nqslraayxr8eq96eqxlw0xtn7l263qskavj4`

Os dois endereços para o **mesmo mnemonic e o mesmo path** são
completamente diferentes — prova direta e reproduzível de que a máscara
errada do código real produz uma carteira Cardano diferente da que a
especificação (e qualquer carteira compatível) produziria.

Verificação adicional: `account_test.go::TestNewAddress` (o teste de
regressão oficial do próprio repositório, mnemonic `"north bulb crunch
need badge orient tissue web east scan invite energy canal solar
eight"`) continua passando sem alteração — confirma que esse mnemonic de
teste específico tem bit 5 = 0 antes do clamp por coincidência, o que
explica por que o próprio test suite do projeto nunca pegou o bug
(qualquer mnemonic de teste único tem só ~50% de chance de expô-lo).

Todos os testes de PoC ficaram apenas no clone local efêmero desta
sessão (`coins/cardano/clamp_poc_test.go`, `coins/cardano/clamp_fixed_test.go`),
nunca commitados ou enviados a lugar nenhum — reproduzíveis por qualquer
pessoa com Go instalado e o clone público do repositório.

## Impacto
Para ~50% de todos os mnemonics/senhas possíveis, a chave-mestra (e
todo endereço derivado dela, em qualquer path) calculada por este SDK
diverge da chave-mestra que qualquer outra carteira Cardano compatível
com CIP-3 calcularia a partir da mesma seed phrase. Cenários de dano
concreto:
- Um usuário cria uma carteira Cardano na OKX (gerada por este SDK) e
  depois tenta importar a mesma mnemonic em outra carteira padrão
  (Yoroi, Ledger, etc.) para verificar ou mover fundos — em ~50% dos
  casos vê um endereço diferente, sem fundos visíveis, com aparência de
  perda de acesso à conta.
- Um usuário importa na OKX uma mnemonic já usada em outra carteira
  Cardano padrão — em ~50% dos casos a OKX deriva (e exibe como
  endereço de depósito) um endereço diferente do endereço real onde os
  fundos do usuário estão em outras carteiras, com risco de o usuário
  enviar fundos para o que ele acredita (incorretamente, guiado pela UI
  da OKX) ser seu próprio endereço.

Não é um bug de dependência (`known_vulnerable_dependency`) nem depende
de nenhuma condição de rede/timing — é um erro determinístico de
implementação criptográfica no próprio código do SDK, presente em 100%
das derivações onde o bit 5 pré-clamp é 1.

## Correção sugerida
Trocar a máscara em `coins/cardano/crypto/key.go:26` de `0x1f` para
`0x7f`:
```go
key[31] = (key[31] & 0x7f) | 0x40
```
Isso alinha o clamp com a especificação CIP-3/Icarus (limpar só o bit
mais alto do byte 31, preservando os demais bits vindos do PBKDF2). Após
a correção, adicionar um caso de teste de regressão que cubra
especificamente um mnemonic com bit 5 pré-clamp = 1 (o vetor de teste
atual do repositório não cobre esse caso por coincidência), para evitar
reintrodução silenciosa do bug.

---
*Gerado automaticamente em 2026-09-04T05:15:00Z a partir do achado
`OKG::okx/go-wallet-sdk/coins/cardano/crypto/key.go::NewXPrvKeyFromEntropy::ai_deep_read_finding`
na fila (`research/bugbounty/queue.jsonl`). Ver histórico completo do
veredito em `ledger/ledger.research.jsonl`.*
