const { Octokit } = require('@octokit/rest');
const octokit = new Octokit({ auth: 'YOUR_GITHUB_PERSONAL_ACCESS_TOKEN' });

const owner = 'OWNER';
const repo = 'REPO';

async function getMergedPRs(owner, repo) {
  try {
    const mergedPRs = [];
    let page = 1;

    while (true) {
      const { data: pullRequests } = await octokit.pulls.list({
        owner,
        repo,
        state: 'closed',
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
        page,
      });

      if (pullRequests.length === 0) {
        break;
      }

      for (const pr of pullRequests) {
        if (pr.merged_at) {
          mergedPRs.push(pr);
        }
      }

      page++;
    }

    return mergedPRs;
  } catch (error) {
    console.error('Error fetching merged PRs:', error);
  }
}

async function getPRReviewTimes(owner, repo, pr) {
  try {
    const { data: reviews } = await octokit.pulls.listReviews({
      owner,
      repo,
      pull_number: pr.number,
    });

    let approvedAt = null;
    for (const review of reviews) {
      if (review.state === 'APPROVED') {
        approvedAt = review.submitted_at;
        break;
      }
    }

    return {
      openedAt: new Date(pr.created_at),
      approvedAt: approvedAt ? new Date(approvedAt) : null,
      mergedAt: new Date(pr.merged_at),
    };
  } catch (error) {
    console.error(`Error fetching PR #${pr.number} reviews:`, error);
  }
}

(async function main() {
  try {
    const mergedPRs = await getMergedPRs(owner, repo);

    for (const pr of mergedPRs) {
      const times = await getPRReviewTimes(owner, repo, pr);
      if (times.approvedAt) {
        const timeToApproval = (times.approvedAt - times.openedAt) / 1000;
        const timeToMerge = (times.mergedAt - times.approvedAt) / 1000;
        console.log(`PR #${pr.number}: Opened at ${times.openedAt}, approved in ${timeToApproval} seconds, merged in ${timeToMerge} seconds`);
      } else {
        console.log(`PR #${pr.number}: Opened at ${times.openedAt}, no approval found, merged at ${times.mergedAt}`);
      }
    }
  } catch (error) {
    console.error('Error in main function:', error);
  }
})();
