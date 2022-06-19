require("dotenv").config();
const { App } = require("@slack/bolt");

const boltApp = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_TOKEN,
});

console.log(
  "process.env.SLACK_SIGNING_SECRET",
  process.env.SLACK_SIGNING_SECRET
);
