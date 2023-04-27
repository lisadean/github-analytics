const { Octokit } = require('@octokit/rest');
const octokit = new Octokit({ auth: process.env.NPM_TOKEN });

const maxPRs = process.argv[2] || 100;

const owner = 'buildcom';
const repo = 'react-build-store';

function addAggregatedData(aggregatedData, sizeLabel, timeToApproval) {
  if (!aggregatedData[sizeLabel]) {
    aggregatedData[sizeLabel] = {
      count: 0,
      totalTime: 0,
    };
  }

  aggregatedData[sizeLabel].count++;
  aggregatedData[sizeLabel].totalTime += timeToApproval;
}

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
  if (days) durationString += `${Math.round(days)}d `;
  if (hours) durationString += `${Math.round(hours)}h `;
  if (minutes) durationString += `${Math.round(minutes)}m `;
  if (seconds) durationString += `${Math.round(seconds)}s`;

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
    let approvedAt = null;
    let page = 1;

    while (true) {
      const { data: reviews } = await octokit.pulls.listReviews({
        owner,
        repo,
        pull_number: pr.number,
        per_page: 100,
        page,
      });

      if (reviews.length === 0) {
        break;
      }

      for (const review of reviews.reverse()) {
        if (review.state === 'APPROVED') {
          if (!approvedAt || new Date(review.submitted_at) > approvedAt) {
            approvedAt = new Date(review.submitted_at);
          }
        }
      }

      if (reviews.length < 100) {
        break;
      } else {
        page++;
      }
    }

    return {
      openedAt: new Date(pr.created_at),
      approvedAt,
      mergedAt: new Date(pr.merged_at),
    };
  } catch (error) {
    console.error(`Error fetching PR #${pr.number} reviews:`, error);
  }
}

(async function main() {
  try {
    const mergedPRs = await getMergedPRs(owner, repo);
    const aggregatedData = {};

    for (const pr of mergedPRs) {
      const times = await getPRReviewTimes(owner, repo, pr);

      const sizeLabel = pr.labels.find((label) =>
        label.name.toLowerCase().startsWith('size')
      );
      const sizeLabelName = sizeLabel ? sizeLabel.name : 'no size label';
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

        addAggregatedData(aggregatedData, sizeLabelName, timeToApproval);
      } else {
        console.log(`PR ${pr.number}: no approval found${sizeLabelInfo}`);
      }
    }

    // Convert the aggregatedData object to an array and sort it
    const sortOrder = [
      'size/XS',
      'size/S',
      'size/M',
      'size/L',
      'size/XL',
      'size/XXL',
    ];
    const sortedData = Object.entries(aggregatedData).sort(
      ([a], [b]) => sortOrder.indexOf(a) - sortOrder.indexOf(b)
    );

    // Calculate the average approval times and store them in an array of objects
    const summaryData = sortedData.map(([sizeLabel, data]) => {
      const averageTime = data.totalTime / data.count;
      return [
        sizeLabel,
        {
          'Size Label': sizeLabel,
          'Average Time': formatDuration(averageTime),
        },
      ];
    });

    // Convert the summaryData array to an object
    const summaryDataObject = Object.fromEntries(summaryData);

    // Display the average approval times in a table format without the index column
    console.log('\nAverage time to approve PRs by size label:');
    console.table(summaryDataObject, ['Average Time']);
  } catch (error) {
    console.error('Error in main function:', error);
  }
})();
