import { createMessageQueue } from "../../src/MessageQueue";
import { UserTokenStore } from "../../src/UserTokenStore";
import { AppserviceMock } from "../utils/AppserviceMock";
import { ApiError, ErrCode, ValidatorApiError } from "../../src/api";
import { GitLabRepoConnection, GitLabRepoConnectionState } from "../../src/Connections";

const ROOM_ID = "!foo:bar";

const GITLAB_ORG_REPO = {
	org: "a-fake-org",
	repo: "a-fake-repo",
};

const GITLAB_MR = {
	state: "opened",
	iid: 1234,
	url: `https://gitlab.example.com/${GITLAB_ORG_REPO.org}/${GITLAB_ORG_REPO.repo}/issues/1234`,
	title: "My MR",
};

const GITLAB_ISSUE_CREATED_PAYLOAD = {
    object_kind: "merge_request",
	user: {
		name: "Alice",
		username: "alice",
	},
	object_attributes: GITLAB_MR,
	project: {
		path_with_namespace: `${GITLAB_ORG_REPO.org}/${GITLAB_ORG_REPO.repo}`,
		web_url: `https://gitlab.example.com/${GITLAB_ORG_REPO.org}/${GITLAB_ORG_REPO.repo}`,
	}
};

function createConnection(state: Record<string, unknown> = {}, isExistingState=false) {
	const mq = createMessageQueue({
		monolithic: true
	});
	mq.subscribe('*');
	const as = AppserviceMock.create();
	const connection = new GitLabRepoConnection(
		ROOM_ID,
		"state_key",
		as,
		GitLabRepoConnection.validateState({
			instance: "bar",
			path: "foo",
			...state,
		}, isExistingState),
		{} as UserTokenStore,
		{
			url: "https://gitlab.example.com"
		},
	);
	return {connection, as};
}

describe("GitLabRepoConnection", () => {
	describe("validateState", () => {
		it("can validate a completes state config", () => {
			GitLabRepoConnection.validateState({
				instance: "foo",
				path: "bar/baz",
				ignoreHooks: [
					"merge_request.open",
					"merge_request.close",
					"merge_request.merge",
					"merge_request.review",
					"merge_request.review.comments",
					"merge_request",
					"tag_push",
					"push",
					"wiki",
					"release",
					"release.created",
				],
				commandPrefix: "!gl",
				pushTagsRegex: ".*",
				includingLabels: ["me"],
				excludingLabels: ["but-not-me"],
			} as GitLabRepoConnectionState as unknown as Record<string, unknown>);
		});
		it("will disallow invalid state", () => {
			try {
				GitLabRepoConnection.validateState({
					instance: "foo",
					path: 123,
				});
			} catch (ex) {
				if (ex instanceof ValidatorApiError === false || ex.errcode !== ErrCode.BadValue) {
					throw ex;
				}
			}
		});
		it("will disallow ignoreHooks to contains invalid enums if this is new state", () => {
			try {
				GitLabRepoConnection.validateState({
					instance: "bar",
					path: "foo",
					ignoreHooks: ["issue", "pull_request", "release", "not-real"],
				}, false);
			} catch (ex) {
				if (ex instanceof ApiError === false || ex.errcode !== ErrCode.BadValue) {
					throw ex;
				}
			}
		});
		it("will allow ignoreHooks to contains invalid enums if this is old state", () => {
			GitLabRepoConnection.validateState({
				instance: "bar",
				path: "foo",
				ignoreHooks: ["issues", "merge_request", "foo"],
			}, true);
		});
	});
	describe("onIssueCreated", () => {
		it("will handle a simple issue", async () => {
			const { connection, as } = createConnection();
			await connection.onMergeRequestOpened(GITLAB_ISSUE_CREATED_PAYLOAD as never);
			// Statement text.
			as.botIntent.expectEventBodyContains('**alice** opened a new MR', 0);
			as.botIntent.expectEventBodyContains(GITLAB_ISSUE_CREATED_PAYLOAD.object_attributes.url, 0);
			as.botIntent.expectEventBodyContains(GITLAB_ISSUE_CREATED_PAYLOAD.object_attributes.title, 0);
		});
		it("will filter out issues not matching includingLabels.", async () => {
			const { connection, as } = createConnection({
				includingLabels: ["include-me"]
			});
			await connection.onMergeRequestOpened({
				...GITLAB_ISSUE_CREATED_PAYLOAD,
				labels: [{
					title: "foo",
				}],
			} as never);
			// ..or issues with no labels
			await connection.onMergeRequestOpened(GITLAB_ISSUE_CREATED_PAYLOAD as never);
			as.botIntent.expectNoEvent();
		});
		it("will filter out issues matching excludingLabels.", async () => {
			const { connection, as } = createConnection({
				excludingLabels: ["exclude-me"]
			});
			await connection.onMergeRequestOpened({
				...GITLAB_ISSUE_CREATED_PAYLOAD,
				labels: [{
					title: "exclude-me",
				}],
			} as never);
			as.botIntent.expectNoEvent();
		});
		it("will include issues matching includingLabels.", async () => {
			const { connection, as } = createConnection({
				includingIssues: ["include-me"]
			});
			await connection.onMergeRequestOpened({
				...GITLAB_ISSUE_CREATED_PAYLOAD,
				labels: [{
					title: "include-me",
				}],
			} as never);
			as.botIntent.expectEventBodyContains('**alice** opened a new MR', 0);
		});
	});
});