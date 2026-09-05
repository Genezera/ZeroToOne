# Estatística de heurísticas — taxa de falso-positivo

Gerado automaticamente por `verdict-stats.mjs` a cada rodada do scanner. Não editar à mão.

## Por tipo × linguagem

| Tipo | Linguagem | Revisados | Confirmados | Falso-positivo | Outro | Taxa FP |
|---|---|---|---|---|---|---|
| ai_deep_read_finding | Go | 2 | 0 | 0 | 2 | 0% |
| ai_deep_read_finding | Rust | 1 | 1 | 0 | 0 | 0% |
| ai_deep_read_finding | TypeScript | 1 | 0 | 1 | 0 | 100% |
| ai_deep_read_finding | clarity | 2 | 0 | 2 | 0 | 100% |
| ai_deep_read_finding | go | 5 | 3 | 1 | 1 | 20% |
| ai_deep_read_finding | kotlin | 4 | 0 | 2 | 2 | 50% |
| ai_deep_read_finding | move | 1 | 0 | 1 | 0 | 100% |
| ai_deep_read_finding | rust | 3 | 2 | 1 | 0 | 33% |
| ai_deep_read_finding | solidity | 4 | 0 | 4 | 0 | 100% |
| ai_deep_read_finding | swift | 2 | 1 | 1 | 0 | 50% |
| ai_deep_read_finding | typescript | 4 | 2 | 1 | 1 | 25% |
| auth_arg_inconsistency | clarity | 1 | 0 | 1 | 0 | 100% |
| command_injection_risk | go | 1 | 0 | 0 | 1 | 0% |
| command_injection_risk | js | 7 | 1 | 6 | 0 | 86% |
| delegatecall_risk | solidity | 1 | 0 | 1 | 0 | 100% |
| eval_usage | js | 3 | 0 | 3 | 0 | 100% |
| insecure_tls | go | 3 | 2 | 1 | 0 | 33% |
| known_vulnerable_dependency | go | 119 | 0 | 119 | 0 | 100% |
| known_vulnerable_dependency | js | 223 | 0 | 223 | 0 | 100% |
| known_vulnerable_dependency | jvm | 4 | 0 | 4 | 0 | 100% |
| known_vulnerable_dependency | unknown | 2 | 0 | 2 | 0 | 100% |
| non_constant_time_hmac_comparison | go | 2 | 2 | 0 | 0 | 0% |
| path_traversal_arbitrary_file_read_risk | javascript | 1 | 1 | 0 | 0 | 0% |
| path_traversal_risk | go | 1 | 0 | 1 | 0 | 100% |
| path_traversal_risk | js | 2 | 0 | 2 | 0 | 100% |
| positional_argument_mismatch | js | 1 | 1 | 0 | 0 | 0% |
| prototype_pollution_risk | js | 2 | 0 | 2 | 0 | 100% |
| redos_risk | js | 3 | 0 | 3 | 0 | 100% |
| reentrancy_risk | solidity | 4 | 0 | 4 | 0 | 100% |
| semgrep_avoid_bind_to_all_interfaces | go | 2 | 0 | 2 | 0 | 100% |
| semgrep_defaulthttpclient_is_deprecated | jvm | 1 | 0 | 1 | 0 | 100% |
| semgrep_detect_child_process | js | 27 | 3 | 24 | 0 | 89% |
| semgrep_exec_detected | unknown | 2 | 0 | 2 | 0 | 100% |
| semgrep_grpc_server_insecure_connection | go | 1 | 0 | 1 | 0 | 100% |
| semgrep_httpsconnection_detected | unknown | 1 | 0 | 1 | 0 | 100% |
| semgrep_insecure_hash_algorithm_sha1 | unknown | 4 | 0 | 4 | 0 | 100% |
| semgrep_math_random_used | go | 22 | 0 | 22 | 0 | 100% |
| semgrep_subprocess_shell_true | unknown | 2 | 0 | 2 | 0 | 100% |
| semgrep_use_of_md5 | go | 4 | 0 | 4 | 0 | 100% |
| semgrep_use_of_sha1 | go | 4 | 0 | 4 | 0 | 100% |
| semgrep_use_of_unsafe_block | go | 231 | 0 | 231 | 0 | 100% |
| semgrep_use_tls | go | 2 | 0 | 2 | 0 | 100% |
| semgrep_var_in_href | unknown | 1 | 0 | 1 | 0 | 100% |
| semgrep_var_in_script_tag | unknown | 2 | 0 | 2 | 0 | 100% |
| slither_arbitrary_send_erc20 | solidity | 1 | 0 | 1 | 0 | 100% |
| slither_arbitrary_send_eth | solidity | 1 | 0 | 1 | 0 | 100% |
| slither_divide_before_multiply | solidity | 4 | 0 | 4 | 0 | 100% |
| slither_encode_packed_collision | solidity | 1 | 0 | 1 | 0 | 100% |
| slither_incorrect_exp | solidity | 2 | 0 | 2 | 0 | 100% |
| slither_incorrect_return | solidity | 4 | 0 | 4 | 0 | 100% |
| slither_msg_value_in_nonpayable | solidity | 1 | 0 | 1 | 0 | 100% |
| slither_reentrancy_balance | solidity | 2 | 0 | 2 | 0 | 100% |
| slither_uninitialized_local | solidity | 2 | 0 | 2 | 0 | 100% |
| ssrf_risk | js | 13 | 0 | 13 | 0 | 100% |
| unchecked_call_return | solidity | 10 | 1 | 9 | 0 | 90% |
| unguarded_transfer | clarity | 2 | 0 | 2 | 0 | 100% |
| weak_crypto_risk | go | 1 | 0 | 1 | 0 | 100% |

## Por tipo × programa

| Tipo | Programa | Revisados | Confirmados | Falso-positivo | Outro | Taxa FP |
|---|---|---|---|---|---|---|
| ai_deep_read_finding | Block Open Source | 6 | 1 | 3 | 2 | 50% |
| ai_deep_read_finding | Circle BBP | 11 | 4 | 7 | 0 | 64% |
| ai_deep_read_finding | OKG | 5 | 2 | 0 | 3 | 0% |
| ai_deep_read_finding | StackingDAO | 2 | 0 | 2 | 0 | 100% |
| ai_deep_read_finding | Vercel Open Source | 5 | 2 | 2 | 1 | 40% |
| auth_arg_inconsistency | StackingDAO | 1 | 0 | 1 | 0 | 100% |
| command_injection_risk | Kubernetes | 1 | 0 | 0 | 1 | 0% |
| command_injection_risk | Vercel Open Source | 7 | 1 | 6 | 0 | 86% |
| delegatecall_risk | Circle BBP | 1 | 0 | 1 | 0 | 100% |
| eval_usage | Vercel Open Source | 3 | 0 | 3 | 0 | 100% |
| insecure_tls | Kubernetes | 3 | 2 | 1 | 0 | 33% |
| known_vulnerable_dependency | Auth0 by Okta | 14 | 0 | 14 | 0 | 100% |
| known_vulnerable_dependency | Block Open Source | 6 | 0 | 6 | 0 | 100% |
| known_vulnerable_dependency | Kiwi.com | 46 | 0 | 46 | 0 | 100% |
| known_vulnerable_dependency | Kubernetes | 42 | 0 | 42 | 0 | 100% |
| known_vulnerable_dependency | Mattermost Public Bug Bounty Engagement  | 38 | 0 | 38 | 0 | 100% |
| known_vulnerable_dependency | OKG | 72 | 0 | 72 | 0 | 100% |
| known_vulnerable_dependency | Plaid | 48 | 0 | 48 | 0 | 100% |
| known_vulnerable_dependency | Vercel Open Source | 82 | 0 | 82 | 0 | 100% |
| non_constant_time_hmac_comparison | Kubernetes | 1 | 1 | 0 | 0 | 0% |
| non_constant_time_hmac_comparison | Mattermost Public Bug Bounty Engagement  | 1 | 1 | 0 | 0 | 0% |
| path_traversal_arbitrary_file_read_risk | Vercel Open Source | 1 | 1 | 0 | 0 | 0% |
| path_traversal_risk | Kubernetes | 1 | 0 | 1 | 0 | 100% |
| path_traversal_risk | Vercel Open Source | 2 | 0 | 2 | 0 | 100% |
| positional_argument_mismatch | Kiwi.com | 1 | 1 | 0 | 0 | 0% |
| prototype_pollution_risk | Vercel Open Source | 2 | 0 | 2 | 0 | 100% |
| redos_risk | Vercel Open Source | 3 | 0 | 3 | 0 | 100% |
| reentrancy_risk | Circle BBP | 4 | 0 | 4 | 0 | 100% |
| semgrep_avoid_bind_to_all_interfaces | Kubernetes | 2 | 0 | 2 | 0 | 100% |
| semgrep_defaulthttpclient_is_deprecated | Auth0 by Okta | 1 | 0 | 1 | 0 | 100% |
| semgrep_detect_child_process | Vercel Open Source | 27 | 3 | 24 | 0 | 89% |
| semgrep_exec_detected | Vercel Open Source | 2 | 0 | 2 | 0 | 100% |
| semgrep_grpc_server_insecure_connection | Kubernetes | 1 | 0 | 1 | 0 | 100% |
| semgrep_httpsconnection_detected | Vercel Open Source | 1 | 0 | 1 | 0 | 100% |
| semgrep_insecure_hash_algorithm_sha1 | Vercel Open Source | 4 | 0 | 4 | 0 | 100% |
| semgrep_math_random_used | Kiwi.com | 1 | 0 | 1 | 0 | 100% |
| semgrep_math_random_used | Kubernetes | 19 | 0 | 19 | 0 | 100% |
| semgrep_math_random_used | OKG | 2 | 0 | 2 | 0 | 100% |
| semgrep_subprocess_shell_true | Vercel Open Source | 2 | 0 | 2 | 0 | 100% |
| semgrep_use_of_md5 | Kubernetes | 1 | 0 | 1 | 0 | 100% |
| semgrep_use_of_md5 | Mattermost Public Bug Bounty Engagement  | 3 | 0 | 3 | 0 | 100% |
| semgrep_use_of_sha1 | Kiwi.com | 1 | 0 | 1 | 0 | 100% |
| semgrep_use_of_sha1 | Kubernetes | 1 | 0 | 1 | 0 | 100% |
| semgrep_use_of_sha1 | OKG | 2 | 0 | 2 | 0 | 100% |
| semgrep_use_of_unsafe_block | Kubernetes | 110 | 0 | 110 | 0 | 100% |
| semgrep_use_of_unsafe_block | OKG | 35 | 0 | 35 | 0 | 100% |
| semgrep_use_of_unsafe_block | Slack | 86 | 0 | 86 | 0 | 100% |
| semgrep_use_tls | Kubernetes | 2 | 0 | 2 | 0 | 100% |
| semgrep_var_in_href | Kubernetes | 1 | 0 | 1 | 0 | 100% |
| semgrep_var_in_script_tag | Mattermost Public Bug Bounty Engagement  | 2 | 0 | 2 | 0 | 100% |
| slither_arbitrary_send_erc20 | Circle BBP | 1 | 0 | 1 | 0 | 100% |
| slither_arbitrary_send_eth | Circle BBP | 1 | 0 | 1 | 0 | 100% |
| slither_divide_before_multiply | Circle BBP | 4 | 0 | 4 | 0 | 100% |
| slither_encode_packed_collision | Circle BBP | 1 | 0 | 1 | 0 | 100% |
| slither_incorrect_exp | Circle BBP | 2 | 0 | 2 | 0 | 100% |
| slither_incorrect_return | Circle BBP | 4 | 0 | 4 | 0 | 100% |
| slither_msg_value_in_nonpayable | Circle BBP | 1 | 0 | 1 | 0 | 100% |
| slither_reentrancy_balance | Circle BBP | 2 | 0 | 2 | 0 | 100% |
| slither_uninitialized_local | Circle BBP | 2 | 0 | 2 | 0 | 100% |
| ssrf_risk | Vercel Open Source | 13 | 0 | 13 | 0 | 100% |
| unchecked_call_return | Circle BBP | 10 | 1 | 9 | 0 | 90% |
| unguarded_transfer | StackingDAO | 2 | 0 | 2 | 0 | 100% |
| weak_crypto_risk | OKG | 1 | 0 | 1 | 0 | 100% |
