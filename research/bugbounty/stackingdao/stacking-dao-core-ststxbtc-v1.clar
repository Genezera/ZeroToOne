(define-constant ERR_SHUTDOWN (err u27001))
(define-constant ERR_WITHDRAW_LOCKED (err u27002))
(define-constant ERR_WITHDRAW_NOT_NFT_OWNER (err u27003))
(define-constant ERR_GET_OWNER (err u27005))
(define-constant ERR_INSUFFICIENT_IDLE (err u27006))
(define-constant ERR_MIN_SHARES (err u27007))
(define-constant ERR_INVALID_FEE (err u27008))

(define-constant DENOMINATOR_BPS u10000)

(define-data-var shutdown-deposits bool false)
(define-data-var shutdown-init-withdraw bool false)
(define-data-var shutdown-withdraw bool false)
(define-data-var shutdown-withdraw-idle bool false)
(define-data-var withdraw-fee uint u0)
(define-data-var withdraw-idle-fee uint u100)
(define-data-var treasury principal tx-sender)
(define-map fee-exempt principal bool)

(define-read-only (get-shutdown-deposits) (var-get shutdown-deposits))
(define-read-only (get-shutdown-init-withdraw) (var-get shutdown-init-withdraw))
(define-read-only (get-shutdown-withdraw) (var-get shutdown-withdraw))
(define-read-only (get-shutdown-withdraw-idle) (var-get shutdown-withdraw-idle))
(define-read-only (get-withdraw-fee) (var-get withdraw-fee))
(define-read-only (get-withdraw-idle-fee) (var-get withdraw-idle-fee))
(define-read-only (get-treasury) (var-get treasury))
(define-read-only (is-fee-exempt (who principal))
  (default-to false (map-get? fee-exempt who))
)


(define-public (deposit (stx-amount uint) (min-shares-out uint))
  (begin
    (try! (contract-call? .dao check-is-enabled))
    (asserts! (not (var-get shutdown-deposits)) ERR_SHUTDOWN)
    (asserts! (>= stx-amount min-shares-out) ERR_MIN_SHARES)

    (try! (stx-transfer? stx-amount tx-sender .stx-reserve))
    (try! (contract-call? .ststxbtc-token-v2 mint-for-protocol stx-amount tx-sender))
    (try! (contract-call? .stx-reserve lock-stx-for-ststxbtc stx-amount))

    (print { action: "deposit", data: { stacker: tx-sender, stx-amount: stx-amount, ststxbtc-amount: stx-amount, block-height: stacks-block-height } })
    (ok stx-amount)
  )
)

(define-public (init-withdraw (ststxbtc-amount uint))
  (let (
    (sender tx-sender)
    (unlock-burn-height (contract-call? .ststxbtc-data-v1 get-withdraw-unlock-burn-height))
  )
    (try! (contract-call? .dao check-is-enabled))
    (asserts! (not (var-get shutdown-init-withdraw)) ERR_SHUTDOWN)

    (let ((nft-id (unwrap-panic (contract-call? .ststxbtc-withdraw-nft-v2 mint-for-protocol sender))))
      (try! (contract-call? .ststxbtc-data-v1 set-withdrawals-by-nft nft-id ststxbtc-amount ststxbtc-amount unlock-burn-height (var-get withdraw-fee)))
      (try! (contract-call? .stx-reserve lock-stx-for-withdrawal-ststxbtc ststxbtc-amount))
      (try! (contract-call? .ststxbtc-token-v2 transfer ststxbtc-amount sender current-contract none))

      (print { action: "init-withdraw", data: { stacker: sender, nft-id: nft-id, stx-amount: ststxbtc-amount, ststxbtc-amount: ststxbtc-amount, unlock-burn-height: unlock-burn-height, block-height: stacks-block-height } })
      (ok nft-id)
    )
  )
)

(define-public (withdraw (nft-id uint))
  (let (
    (receiver tx-sender)
    (entry (contract-call? .ststxbtc-data-v1 get-withdrawals-by-nft nft-id))
    (unlock-burn-height (get unlock-burn-height entry))
    (stx-amount (get asset-amount entry))
    (ststxbtc-amount (get token-amount entry))
    (stx-fee (/ (* (get withdraw-fee entry) stx-amount) DENOMINATOR_BPS))
    (stx-user (- stx-amount stx-fee))
    (nft-owner (unwrap! (unwrap! (contract-call? .ststxbtc-withdraw-nft-v2 get-owner nft-id) ERR_GET_OWNER) ERR_GET_OWNER))
  )
    (try! (contract-call? .dao check-is-enabled))
    (asserts! (not (var-get shutdown-withdraw)) ERR_SHUTDOWN)
    (asserts! (is-eq nft-owner tx-sender) ERR_WITHDRAW_NOT_NFT_OWNER)
    (asserts! (>= burn-block-height unlock-burn-height) ERR_WITHDRAW_LOCKED)

    (try! (contract-call? .ststxbtc-data-v1 delete-withdrawals-by-nft nft-id))

    (if (> stx-fee u0)
      (try! (contract-call? .stx-reserve request-stx-for-withdrawal-ststxbtc stx-fee (var-get treasury)))
      u0
    )
    (try! (contract-call? .stx-reserve request-stx-for-withdrawal-ststxbtc stx-user receiver))
    (try! (contract-call? .ststxbtc-token-v2 burn-for-protocol ststxbtc-amount current-contract))
    (try! (contract-call? .ststxbtc-withdraw-nft-v2 burn-for-protocol nft-id))

    (print { action: "withdraw", data: { stacker: receiver, nft-id: nft-id, stx-user: stx-user, stx-fee: stx-fee, ststxbtc-amount: ststxbtc-amount, block-height: stacks-block-height } })
    (ok { stx-user: stx-user, stx-fee: stx-fee })
  )
)

(define-public (withdraw-idle (ststxbtc-amount uint))
  (let (
    (receiver tx-sender)
    (stx-fee (if (is-fee-exempt tx-sender) u0 (/ (* (var-get withdraw-idle-fee) ststxbtc-amount) DENOMINATOR_BPS)))
    (stx-user (- ststxbtc-amount stx-fee))
  )
    (try! (contract-call? .dao check-is-enabled))
    (asserts! (not (var-get shutdown-withdraw-idle)) ERR_SHUTDOWN)

    (try! (contract-call? .ststxbtc-token-v2 burn-for-protocol ststxbtc-amount receiver))
    (if (> stx-fee u0)
      (try! (contract-call? .stx-reserve pay-stx-from-idle-ststxbtc stx-fee (var-get treasury)))
      u0
    )
    (try! (contract-call? .stx-reserve pay-stx-from-idle-ststxbtc stx-user receiver))

    (print { action: "withdraw-idle", data: { stacker: receiver, stx-user: stx-user, stx-fee: stx-fee, ststxbtc-amount: ststxbtc-amount, block-height: stacks-block-height } })
    (ok { stx-user: stx-user, stx-fee: stx-fee })
  )
)


(define-public (set-shutdown-deposits (shutdown bool))
  (begin
    (try! (contract-call? .dao check-is-protocol contract-caller))
    (var-set shutdown-deposits shutdown)
    (print { action: "set-shutdown-deposits", data: { shutdown: shutdown, block-height: stacks-block-height } })
    (ok true)
  )
)

(define-public (set-shutdown-init-withdraw (shutdown bool))
  (begin
    (try! (contract-call? .dao check-is-protocol contract-caller))
    (var-set shutdown-init-withdraw shutdown)
    (print { action: "set-shutdown-init-withdraw", data: { shutdown: shutdown, block-height: stacks-block-height } })
    (ok true)
  )
)

(define-public (set-shutdown-withdraw (shutdown bool))
  (begin
    (try! (contract-call? .dao check-is-protocol contract-caller))
    (var-set shutdown-withdraw shutdown)
    (print { action: "set-shutdown-withdraw", data: { shutdown: shutdown, block-height: stacks-block-height } })
    (ok true)
  )
)

(define-public (set-withdraw-fee (fee uint))
  (begin
    (try! (contract-call? .dao check-is-protocol contract-caller))
    (asserts! (< fee DENOMINATOR_BPS) ERR_INVALID_FEE)
    (var-set withdraw-fee fee)
    (print { action: "set-withdraw-fee", data: { fee: fee, block-height: stacks-block-height } })
    (ok true)
  )
)

(define-public (set-shutdown-withdraw-idle (shutdown bool))
  (begin
    (try! (contract-call? .dao check-is-protocol contract-caller))
    (var-set shutdown-withdraw-idle shutdown)
    (print { action: "set-shutdown-withdraw-idle", data: { shutdown: shutdown, block-height: stacks-block-height } })
    (ok true)
  )
)

(define-public (set-withdraw-idle-fee (fee uint))
  (begin
    (try! (contract-call? .dao check-is-protocol contract-caller))
    (asserts! (< fee DENOMINATOR_BPS) ERR_INVALID_FEE)
    (var-set withdraw-idle-fee fee)
    (print { action: "set-withdraw-idle-fee", data: { fee: fee, block-height: stacks-block-height } })
    (ok true)
  )
)

(define-public (set-treasury (new-treasury principal))
  (begin
    (try! (contract-call? .dao check-is-protocol contract-caller))
    (var-set treasury new-treasury)
    (print { action: "set-treasury", data: { new-treasury: new-treasury, block-height: stacks-block-height } })
    (ok true)
  )
)

(define-public (set-fee-exempt (who principal) (exempt bool))
  (begin
    (try! (contract-call? .dao check-is-protocol contract-caller))
    (map-set fee-exempt who exempt)
    (ok true)
  )
)
