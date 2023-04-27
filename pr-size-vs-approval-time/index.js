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
    const oneYearAgo = new Date();
    oneYearAgo.setDate(oneYearAgo.getDate() - 365);

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
        const mergedAt = new Date(pr.merged_at);
        if (pr.merged_at && mergedAt >= oneYearAgo) {
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
    const prDataArray = [];

    console.log('Processing merged PRs...');
    for (const pr of mergedPRs) {
      const times = await getPRReviewTimes(owner, repo, pr);

      const sizeLabel = pr.labels.find((label) =>
        label.name.toLowerCase().startsWith('size')
      );
      const sizeLabelName = sizeLabel ? sizeLabel.name : 'no size label';

      if (times.approvedAt) {
        const timeToApproval = (times.approvedAt - times.openedAt) / 1000;
        const timeToMerge = (times.mergedAt - times.approvedAt) / 1000;

        prDataArray.push([
          [pr.number],
          {
            Opened: formatShortDate(times.openedAt),
            'Approved in': formatDuration(timeToApproval),
            'Merged in': formatDuration(timeToMerge),
            'Size Label': sizeLabelName,
          },
        ]);

        addAggregatedData(aggregatedData, sizeLabelName, timeToApproval);
      } else {
        prDataArray.push([
          [pr.number],
          {
            Opened: formatShortDate(times.openedAt),
            'Approved in': 'No approval found',
            'Merged in': '',
            'Size Label': sizeLabelName,
          },
        ]);
      }
      process.stdout.write('.');
    }

    const prDataArrayObject = Object.fromEntries(prDataArray);
    console.log(`\nTotal PRs: ${mergedPRs.length}`);
    console.log('\nIndividual PR data:');
    console.table(prDataArrayObject, [
      'Opened',
      'Approved in',
      'Merged in',
      'Size Label',
    ]);

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

    const summaryData = sortedData.map(([sizeLabel, data]) => {
      const averageTime = data.totalTime / data.count;
      return [
        sizeLabel,
        {
          'Size Label': sizeLabel,
          Count: data.count,
          'Average Time': formatDuration(averageTime),
        },
      ];
    });

    const summaryDataObject = Object.fromEntries(summaryData);
    console.log('\nAverage time to approve PRs by size label:');
    console.table(summaryDataObject, ['Size Label', 'Count', 'Average Time']);
  } catch (error) {
    console.error('Error in main function:', error);
  }
})();
