import { arrayFilterUnique } from "jsr:@edjopato/array-filter-unique@^3";
import {
	MY_REPOS_SEARCH_PARAMS,
	octokit,
	searchGithubRepos,
} from "./lib/github.ts";
import { logArray } from "./lib/log.ts";

function isCheckWanted(name: string): boolean {
	const lower = name.toLowerCase();
	if (lower.includes("beta") || lower.includes("nightly")) {
		return false;
	}
	return WANTED_CHECKS
		.some((wanted) => lower === wanted || lower.startsWith(wanted + " "));
}

// Do not add website-stalker. The git push doesnt work anymore then
const WANTED_CHECKS = [
	"build", // Probably PlatformIO
	"check",
	"clippy",
	"denofmt-and-lint",
	"doc",
	"features",
	"lint",
	"msrv",
	"node.js",
	"publish-dry-run",
	"release",
	"run with example config", // website-stalker
	"rustfmt",
	"test",
] as const satisfies string[];

async function removeBranchProtections(owner: string, repo: string) {
	const branchesResponse = await octokit.request(
		"GET /repos/{owner}/{repo}/branches",
		{ owner, repo },
	);
	const protectedBranches = branchesResponse.data
		.filter((o) => o.protection?.enabled)
		.map((o) => o.name);
	for (const branch of protectedBranches) {
		await octokit.request(
			"DELETE /repos/{owner}/{repo}/branches/{branch}/protection",
			{ owner, repo, branch },
		);
	}
}

async function updateRulesets(
	owner: string,
	repo: string,
	ghaPushesToDefault: boolean,
	relevantChecks: ReadonlyArray<Readonly<{ name: string; appId?: number }>>,
) {
	const rulesetsResponse = await octokit.request(
		"GET /repos/{owner}/{repo}/rulesets",
		{ owner, repo },
	);

	async function ensureRuleset(
		target: "branch" | "tag",
		name: string,
	): Promise<number> {
		let id = rulesetsResponse.data.find((rule) =>
			rule.source_type === "Repository" &&
			rule.target === target &&
			rule.name === name
		)?.id;
		if (!id) {
			const bla = await octokit.request("POST /repos/{owner}/{repo}/rulesets", {
				owner,
				repo,
				target,
				name,
				enforcement: "disabled",
			});
			id = bla.data.id;
		}
		return id;
	}

	await octokit.request("PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}", {
		owner,
		repo,
		ruleset_id: await ensureRuleset("tag", "Tags except versions"),
		enforcement: "active",
		conditions: {
			ref_name: { include: ["~ALL"], exclude: ["refs/tags/v*.*.*"] },
		},
		rules: [
			{ type: "creation" },
			{ type: "deletion" },
			{ type: "non_fast_forward" },
			{ type: "required_linear_history" },
			{ type: "required_signatures" },
			{ type: "update" },
		],
	});
	await octokit.request("PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}", {
		owner,
		repo,
		ruleset_id: await ensureRuleset("tag", "Version Tags"),
		enforcement: "active",
		conditions: { ref_name: { include: ["refs/tags/v*.*.*"], exclude: [] } },
		bypass_actors: [
			{
				actor_id: 1,
				actor_type: "OrganizationAdmin",
				bypass_mode: "always",
			},
			{
				actor_id: 5, // Repository Admin
				actor_type: "RepositoryRole",
				bypass_mode: "always",
			},
		],
		rules: [
			{ type: "creation" },
			{ type: "deletion" },
			{ type: "non_fast_forward" },
			{ type: "required_linear_history" },
			{ type: "required_signatures" },
			{ type: "update" },
		],
	});

	const prRule = {
		type: "pull_request",
		parameters: {
			dismiss_stale_reviews_on_push: true,
			require_code_owner_review: true,
			require_last_push_approval: relevantChecks.length === 0, // When there is no check, require approval
			required_approving_review_count: 0,
			required_review_thread_resolution: true,
		},
	} as const;

	try {
		await octokit.request("PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}", {
			owner,
			repo,
			ruleset_id: await ensureRuleset("branch", "Default Branch Protection"),
			enforcement: "active",
			conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
			bypass_actors: [
				{
					actor_id: 1,
					actor_type: "OrganizationAdmin",
					bypass_mode: "always",
				},
				{
					actor_id: 5, // Repository Admin
					actor_type: "RepositoryRole",
					bypass_mode: "always",
				},
			],
			rules: [
				{ type: "creation" },
				{ type: "non_fast_forward" },
				{ type: "deletion" },
				{ type: "required_linear_history" },
				{
					type: "required_status_checks",
					parameters: {
						strict_required_status_checks_policy: true,
						required_status_checks: relevantChecks.map((check) => ({
							context: check.name,
							integration_id: check.appId,
						})),
					},
				},
				...(ghaPushesToDefault ? [] : [prRule]),
			],
		});
	} catch (err) {
		console.error(
			"update default branch ruleset error",
			err instanceof Error ? err.message : err,
		);
	}
}

async function doRepo(
	owner: string,
	repo: string,
	privateRepo: boolean,
	defaultBranch: string,
) {
	console.log("\ndo repo", owner, repo);

	await octokit.request(
		"PUT /repos/{owner}/{repo}/subscription",
		{ owner, repo, subscribed: true },
	);

	await octokit.request("PATCH /repos/{owner}/{repo}", {
		owner,
		repo,
		allow_auto_merge: true,
		allow_merge_commit: false,
		allow_rebase_merge: false,
		allow_squash_merge: true,
		allow_update_branch: true,
		delete_branch_on_merge: true,
		has_wiki: false,
		web_commit_signoff_required: true,
		security_and_analysis: {
			// @ts-expect-error type not yet known
			dependabot_security_updates: { status: "disabled" },
			secret_scanning: privateRepo ? undefined : { status: "enabled" },
			secret_scanning_push_protection: { status: "enabled" },
		},
	});

	await octokit.request(
		"PUT /repos/{owner}/{repo}/actions/permissions/workflow",
		{
			owner,
			repo,
			can_approve_pull_request_reviews: false,
			default_workflow_permissions: "read",
		},
	);

	await removeBranchProtections(owner, repo);

	const checksResponse = await octokit.request(
		"GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
		{ owner, repo, ref: defaultBranch },
	);
	const allChecks = checksResponse.data.check_runs
		.filter((check) => check.app?.id !== 29110) // Dependabot
		.map((check) => ({ appId: check.app?.id, name: check.name }))
		.filter(arrayFilterUnique((check) => `${check.appId} ${check.name}`))
		.sort((a, b) => a.name.localeCompare(b.name));
	const ghaPushesToDefault = allChecks
		.some((check) => check.name === "website-stalker");
	const relevantChecks = allChecks.filter((check) => isCheckWanted(check.name));
	// logNonEmptyArray("relevant checks", relevantChecks);

	if (!privateRepo) {
		await updateRulesets(owner, repo, ghaPushesToDefault, relevantChecks);
	}

	return allChecks.map((check) => check.name);
}

const repos = await searchGithubRepos([
	"fork:true",
	"archived:false",
	...MY_REPOS_SEARCH_PARAMS,
].join(" "));
console.log("total repos", repos.length);

let allChecks: string[] = [];
for (const repo of repos) {
	const result = await doRepo(
		repo.owner!.login,
		repo.name,
		repo.private,
		repo.default_branch,
	);
	allChecks.push(...(result ?? []));
}

console.log("\n\nall done");
allChecks = allChecks
	.filter(arrayFilterUnique())
	.sort((a, b) => a.localeCompare(b));
const unusedWantedChecks = [...WANTED_CHECKS]
	.filter((o) => !allChecks.includes(o));
const wantedChecks = allChecks.filter((o) => isCheckWanted(o));
const ignoredChecks = allChecks.filter((o) => !isCheckWanted(o));
logArray("unused WANTED checks", unusedWantedChecks);
logArray("wanted checks", wantedChecks);
logArray("ignored checks", ignoredChecks);
