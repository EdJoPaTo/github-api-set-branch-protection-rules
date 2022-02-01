import {Octokit} from '@octokit/core';

// Create a personal access token at https://github.com/settings/tokens/new?scopes=repo
// Then use `export GITHUB_PAT='ghp_…'`
const octokit = new Octokit({auth: process.env['GITHUB_PAT']});

const EXPECTED_OWNERS = ['EdJoPaTo', 'HAWHHCalendarBot'];

void doit();
async function doit() {
    let {data: notificationsResponse} = await octokit.request('GET /notifications', {
        per_page: 100,
    });
    let filtered = notificationsResponse
        .filter(o => o.subject.type === 'PullRequest')
        .filter(o => EXPECTED_OWNERS.includes(o.repository.owner.login))

    console.log('found', filtered.length, 'notifications');
    // console.log(filtered);

    for (const notification of filtered) {
        console.log();
        let owner = notification.repository.owner.login;
        let repo = notification.repository.name;
        let pull_number = Number(notification.subject.url.split('/').slice(-1)[0]);

        console.log('check pr', owner, repo, pull_number, notification.subject.url);
        let {data: pr} = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
            owner, repo, pull_number,
        });
        console.log(pr.merged ? 'merged' : pr.state, '·', pr.title);


        if (pr.user?.login !== 'dependabot[bot]' || pr.draft) {
            console.log('not from dependabot');
            continue;
        }

        if (notification.unread && (pr.state === 'closed' || pr.auto_merge)) {
            await octokit.request('PATCH /notifications/threads/{thread_id}', {
                thread_id: Number(notification.id),
            });
        }
    }
}
