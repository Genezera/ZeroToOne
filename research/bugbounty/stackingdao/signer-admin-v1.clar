;; @contract Signer Admin (shared)
;; @version 1
;;
;; Shared admin registry for the signer-manager instances. Instead of every
;; signer-manager re-implementing an `admins` map + authorize-admin, each
;; instance delegates its admin check here. Admins are keyed by
;; (manager, who), so this one module serves every deployed signer-manager.
;;
;; Auth tiers: appointment of admins is DAO-gated (set-admin checks
;; dao.check-is-protocol), a distinct governance tier; the appointed admin then
;; performs routine per-signer operations (fees, allowlist, recipient) on its
;; instance, which gates those ops on is-admin here. There is no self-bootstrap,
;; so an instance cannot be seized by a front-run before the DAO wires it.

(define-constant ERR_NOT_ADMIN (err u35001))

(define-map admins
  {
    manager: principal,
    who: principal,
  }
  bool
)

(define-read-only (is-admin (manager principal) (who principal))
  (default-to false (map-get? admins { manager: manager, who: who }))
)

;; DAO-gated. Appoint or revoke `who` as an admin of signer-manager `manager`.
(define-public (set-admin (manager principal) (who principal) (enabled bool))
  (begin
    (try! (contract-call? .dao check-is-protocol contract-caller))
    (map-set admins { manager: manager, who: who } enabled)
    (print { action: "set-admin", data: { manager: manager, who: who, enabled: enabled, block-height: stacks-block-height } })
    (ok true)
  )
)
