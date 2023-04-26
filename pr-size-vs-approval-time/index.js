const { Octokit } = require('@octokit/rest');
const octokit = new Octokit({ auth: process.env.NPM_TOKEN });

const maxPRs = 5;

const owner = 'buildcom';
const repo = 'react-build-store';

function formatShortDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();

  return `${month}/${day}/${year}`;
}

function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  let durationString = '';
  if (days) durationString += `${days}d `;
  if (hours) durationString += `${hours}h `;
  if (minutes) durationString += `${minutes}m `;
  if (seconds) durationString += `${seconds}s`;

  return durationString;
}

async function getMergedPRs(owner, repo) {
  try {
    const mergedPRs = [];
    let page = 1;

    while (mergedPRs.length < maxPRs) {
      const { data: pullRequests } = await octokit.pulls.list({
        owner,
        repo,
        state: 'closed',
        sort: 'updated',
        direction: 'desc',
        per_page: maxPRs < 100 ? maxPRs : 100,
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

      const sizeLabel = pr.labels.find((label) =>
        label.name.toLowerCase().startsWith('size')
      );
      const sizeLabelInfo = sizeLabel ? `, size label: ${sizeLabel.name}` : '';

      if (times.approvedAt) {
        const timeToApproval = (times.approvedAt - times.openedAt) / 1000;
        const timeToMerge = (times.mergedAt - times.approvedAt) / 1000;
        console.log(
          `PR ${pr.number}: opened ${formatShortDate(
            times.openedAt
          )}, approved in ${formatDuration(
            timeToApproval
          )}, merged in ${formatDuration(timeToMerge)}${sizeLabelInfo}`
        );
      } else {
        console.log(`PR ${pr.number}: no approval found`);
      }
    }
  } catch (error) {
    console.error('Error in main function:', error);
  }
})();
