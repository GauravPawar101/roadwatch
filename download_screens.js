const fs = require('fs');
const path = require('path');
const https = require('https');

const urls = {
  CitizenDashboard: 'https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ7Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpaCiVodG1sXzdjMzYzZmZmZTVhZjQ0YjY4NmU4OTQxNzhkNTYwN2I0EgsSBxDR6IGF9h8YAZIBIwoKcHJvamVjdF9pZBIVQhM0NjgxNTY5NzIzNDA4MTAyNDE2&filename=&opi=89354086',
  ComplaintDetail: 'https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ7Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpaCiVodG1sXzQzMWEzZDBkYzY4NDQ3Nzc5ZjI3YzExZDA4ZjY3MzdiEgsSBxDR6IGF9h8YAZIBIwoKcHJvamVjdF9pZBIVQhM0NjgxNTY5NzIzNDA4MTAyNDE2&filename=&opi=89354086',
  ComplaintWizard: 'https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ7Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpaCiVodG1sXzk1ZTc2M2U1MmU4YTRjNGE4N2ZmOWJlNmU5MjBlMTNmEgsSBxDR6IGF9h8YAZIBIwoKcHJvamVjdF9pZBIVQhM0NjgxNTY5NzIzNDA4MTAyNDE2&filename=&opi=89354086',
  MapView: 'https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ7Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpaCiVodG1sXzAxZDA0YmE4MTJhOTRjZmM4N2M2MGZhYWNjNjA1OTk0EgsSBxDR6IGF9h8YAZIBIwoKcHJvamVjdF9pZBIVQhM0NjgxNTY5NzIzNDA4MTAyNDE2&filename=&opi=89354086',
  MyComplaints: 'https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ7Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpaCiVodG1sXzZkZmYyMjc2NDQwYTRhM2E5M2NlMmY5MzFmOTE0OGY1EgsSBxDR6IGF9h8YAZIBIwoKcHJvamVjdF9pZBIVQhM0NjgxNTY5NzIzNDA4MTAyNDE2&filename=&opi=89354086'
};

const outputDir = path.join(__dirname, 'downloaded_screens');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function download(name, url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        const dest = path.join(outputDir, `${name}.html`);
        fs.writeFileSync(dest, data, 'utf-8');
        console.log(`✓ Downloaded ${name} to ${dest}`);
        resolve();
      });
    }).on('error', (err) => {
      console.error(`Error downloading ${name}:`, err);
      reject(err);
    });
  });
}

async function run() {
  for (const [name, url] of Object.entries(urls)) {
    await download(name, url);
  }
}

run();
