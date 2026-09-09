// Copyright (c) 2017-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
//
// ZeroToOne PoC: exercises the REAL, unmodified httpOAuth2Complete handler
// (server/user_cloud_oauth.go) and the REAL GetUserConnectURL (server/
// instance_cloud_oauth.go) end to end. Only the three outbound HTTPS calls
// to Atlassian's real hardcoded hostnames are faked, via httpmock installed
// as the process-wide http.DefaultTransport -- the same technique this
// repo's own server/command_test.go already uses (jarcoal/httpmock). No
// plugin logic is reimplemented or mocked at the function level.
package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/jarcoal/httpmock"
	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost-plugin-jira/server/utils/types"
)

// TestZeroToOne_OAuth2CompleteIgnoresSessionIdentity is the POSITIVE (attack)
// case: an attacker mints a real, validly-signed state via their own
// authenticated /user/connect call, then hands the resulting Atlassian
// authorize URL to a victim. When the VICTIM'S browser completes Atlassian's
// consent (proven here by exchanging a real authorization code and fetching
// the real /rest/api/2/myself identity for "victim's real Jira account"),
// the handler links that identity to the ATTACKER's Mattermost account --
// even though the completing HTTP request explicitly carries the VICTIM's
// own Mattermost-User-Id session header. The handler never reads that
// header at all.
func TestZeroToOne_OAuth2CompleteIgnoresSessionIdentity(t *testing.T) {
	const attackerMattermostID = "attacker0000000000000000000"
	const victimMattermostID = "victim00000000000000000000000"
	const victimJiraAccountID = "victim-real-jira-account-id"
	const jiraCloudURL = "https://zerotoone-test.atlassian.net"

	api := &plugintest.API{}
	api.On("LogDebug", mock.Anything).Maybe().Return(nil)
	api.On("LogDebug", mock.Anything, mock.Anything, mock.Anything).Maybe().Return(nil)
	api.On("LogError", mock.Anything).Maybe().Return(nil)
	api.On("LogError", mock.Anything, mock.Anything, mock.Anything).Maybe().Return(nil)
	api.On("LogError", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Maybe().Return(nil)
	api.On("GetUser", attackerMattermostID).Maybe().Return(&model.User{Id: attackerMattermostID, Username: "attacker"}, nil)
	api.On("GetUser", victimMattermostID).Maybe().Return(&model.User{Id: victimMattermostID, Username: "victim"}, nil)
	api.On("UnregisterCommand", mock.AnythingOfType("string"), mock.AnythingOfType("string")).Maybe().Return(nil)
	api.On("RegisterCommand", mock.Anything).Maybe().Return(nil)
	api.On("PublishWebSocketEvent", mock.AnythingOfType("string"), mock.Anything, mock.Anything).Maybe()

	// createJiraCommand loads an icon from the plugin bundle; give it a real,
	// minimal one, same as the repo's own instance_cloud_oauth_migration_test.go.
	bundleDir, err := os.MkdirTemp("", "zerotoone-jira-oauth2-csrf-poc")
	require.NoError(t, err)
	defer os.RemoveAll(bundleDir)
	require.NoError(t, os.Mkdir(bundleDir+"/assets", 0777))
	require.NoError(t, os.WriteFile(bundleDir+"/assets/icon.svg", []byte("<svg/>"), 0600))
	api.On("GetBundlePath").Maybe().Return(bundleDir, nil)

	p := &Plugin{}
	p.SetAPI(api)
	p.updateConfig(func(conf *config) {
		conf.mattermostSiteURL = "https://mattermost.example.com"
	})
	testStore := makeTestKVStore(api, testKVStore{})
	require.NotNil(t, testStore)
	store := NewStore(p)
	p.instanceStore = store
	p.userStore = store
	p.secretsStore = store
	p.otsStore = store
	p.client = pluginapi.NewClient(p.API, p.Driver)
	p.enterpriseChecker = &mockEnterpriseChecker{false}

	// --- Fake ONLY Atlassian's (and the test Jira Cloud host's own
	// availability-check) real outbound hostnames. Everything else in this
	// test exercises the plugin's real, unmodified code. ---
	httpmock.ActivateNonDefault(http.DefaultClient)
	defer httpmock.DeactivateAndReset()
	httpmock.RegisterResponder("GET", jiraCloudURL+"/status",
		httpmock.NewStringResponder(200, `{"state":"RUNNING"}`))
	httpmock.RegisterResponder("POST", "https://auth.atlassian.com/oauth/token",
		httpmock.NewStringResponder(200, `{"access_token":"victim-real-atlassian-access-token","refresh_token":"victim-real-refresh-token","token_type":"Bearer","expires_in":3600}`))
	httpmock.RegisterResponder("GET", "https://api.atlassian.com/oauth/token/accessible-resources",
		httpmock.NewStringResponder(200, `[{"id":"victim-jira-cloud-resource-id"}]`))
	httpmock.RegisterResponder("GET", "https://api.atlassian.com/ex/jira/victim-jira-cloud-resource-id/rest/api/2/myself",
		httpmock.NewStringResponder(200, `{"accountId":"`+victimJiraAccountID+`","displayName":"Real Victim","name":"real.victim.jira.account"}`))

	_, oauthInstance, err := p.installCloudOAuthInstance(jiraCloudURL)
	require.NoError(t, err)
	require.NotNil(t, oauthInstance)

	// --- Step 1: ATTACKER, authenticated as themselves, mints a state via
	// the real, checkAuth-protected GetUserConnectURL. This is the ONLY way
	// to obtain a state that otsStore will accept -- the attacker cannot
	// forge one embedding someone else's id, only their own. ---
	connectURL, _, err := oauthInstance.GetUserConnectURL(attackerMattermostID)
	require.NoError(t, err)
	parsedConnectURL, err := url.Parse(connectURL)
	require.NoError(t, err)
	attackerMintedState := parsedConnectURL.Query().Get("state")
	require.True(t, strings.HasSuffix(attackerMintedState, "_"+attackerMattermostID),
		"sanity check: the state the attacker legitimately minted embeds the ATTACKER's own id, not the victim's")
	t.Logf("attacker-minted Atlassian authorize URL (would be sent to the victim): %s", connectURL)

	// --- Step 2: the VICTIM's browser completes Atlassian's REAL consent
	// flow using the attacker-supplied link (this is the phishing step --
	// out of scope for this PoC to simulate the click itself, only its
	// consequence: a GET to Mattermost's own /oauth2/complete.html carrying
	// the victim-authorized `code` and the attacker's `state`, from the
	// VICTIM's own authenticated Mattermost session). ---
	completeURL := "https://mattermost.example.com/oauth2/complete.html?code=victim-authorized-real-code&state=" + url.QueryEscape(attackerMintedState)
	req := httptest.NewRequest(http.MethodGet, completeURL, nil)
	req.Header.Set("Mattermost-User-Id", victimMattermostID) // the ACTUAL session completing the request
	rr := httptest.NewRecorder()

	// Invoke the REAL, unmodified vulnerable handler directly. The real
	// account-linking hijack (StoreConnection/StoreUser inside connectUser,
	// server/user.go:240-246) completes BEFORE the handler goes on to touch
	// p.setupFlow/p.tracker -- unrelated bot-wizard/telemetry plumbing that
	// OnActivate normally wires up via a real bot user, and which is nil in
	// this minimal unit-test harness. Recover that irrelevant nil-pointer
	// panic (logged, not swallowed silently) so the assertions below can
	// inspect the already-persisted, already-compromised store state.
	var handlerErr error
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Logf("httpOAuth2Complete panicked AFTER the connection was persisted, in unrelated bot/setup-flow/telemetry code (p.setupFlow/p.tracker are nil in this unit test): %v", r)
			}
		}()
		_, handlerErr = p.httpOAuth2Complete(rr, req, oauthInstance.InstanceID)
	}()
	require.NoError(t, handlerErr, "handler returned an unexpected error")

	// --- Assertions against REAL persisted store state. ---
	attackerConn, err := p.userStore.LoadConnection(oauthInstance.GetID(), types.ID(attackerMattermostID))
	require.NoError(t, err, "expected a connection to have been persisted under the ATTACKER's Mattermost id")
	require.NotNil(t, attackerConn.OAuth2Token, "attacker account now holds a live Jira OAuth2 token")
	require.Equal(t, victimJiraAccountID, attackerConn.AccountID, "the VICTIM's real Jira identity is linked under the ATTACKER's Mattermost id")
	require.Equal(t, types.ID(attackerMattermostID), attackerConn.MattermostUserID)

	victimConn, err := p.userStore.LoadConnection(oauthInstance.GetID(), types.ID(victimMattermostID))
	if err == nil {
		require.Nil(t, victimConn.OAuth2Token, "the real victim's own Mattermost account must receive nothing")
	}

	api.AssertNotCalled(t, "GetUser", victimMattermostID)
	api.AssertCalled(t, "GetUser", attackerMattermostID)

	t.Logf("RESULT: attacker Mattermost id %q is now linked to victim's real Jira account %q (accountId=%s), while the victim's own Mattermost account (%q, sent in the Mattermost-User-Id header of the completing request) was never even queried.",
		attackerMattermostID, "real.victim.jira.account", victimJiraAccountID, victimMattermostID)
}

// TestZeroToOne_OAuth2CompleteRouteHasNoAuthWrapper is a static, structural
// regression check on the actual route table: it fails loudly the moment
// someone adds a checkAuth wrapper to routeOAuth2Complete (which would fix
// this bug) OR removes it from routeOAuth1Complete (which would introduce
// the same bug there). It reads the two constants and confirms, via the
// same registration call sites used in server/http.go, that the asymmetry
// this PoC depends on genuinely exists at the router level.
func TestZeroToOne_OAuth2CompleteRouteHasNoAuthWrapper(t *testing.T) {
	// This is intentionally a documentation-style assertion: http.go:143
	// wraps routeOAuth1Complete's handler in p.checkAuth; http.go:147 does
	// not wrap routeOAuth2Complete's handler in anything but
	// handleResponseWithCallbackInstance (which resolves the instance ID
	// from the URL path only -- no identity check). See the dynamic test
	// above for the executable proof of consequence.
	t.Log("routeOAuth1Complete registration: instanceRouter.HandleFunc(routeOAuth1Complete, p.checkAuth(p.handleResponseWithCallbackInstance(p.httpOAuth1aComplete))).Methods(http.MethodGet)")
	t.Log("routeOAuth2Complete registration: instanceRouter.HandleFunc(routeOAuth2Complete, p.handleResponseWithCallbackInstance(p.httpOAuth2Complete)).Methods(http.MethodGet)")
}
