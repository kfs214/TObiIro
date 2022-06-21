import "dotenv/config";
import { App } from "@slack/bolt";
import { subDays } from "date-fns";

//
// Types
//

//
// instances
//
const { client: boltClient } = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_TOKEN,
});

//
// Functions
//
const fetchLatestMessages = async (
  channelIds: string[],
  forwardedDays: number,
  maxMessagesInChannel?: number
) => {
  const messagesOldestTimestamp =
    subDays(new Date(), forwardedDays).getTime() / 1000;

  const conversationsHistoryResults = await Promise.all(
    await channelIds.map(async (channelId) => {
      const res = await boltClient.conversations
        .history({
          channel: channelId,
          limit: maxMessagesInChannel,
          oldest: `${messagesOldestTimestamp}`,
        })
        .catch((e) => {
          console.log(e);
          return null;
        });

      return res;
    })
  ).then((results) =>
    results
      .filter((result) => result)
      .flatMap((result) => result?.messages)
      .filter((message) => message)
  );

  return conversationsHistoryResults;
};

// TODO うまく型をつけたい
// const composeForwardedContent = (conversationsHistory: ) => { third }

//
// main
//
const main = async () => {
  console.log("starting process...", new Date().toISOString());

  const conversationsHistoryResults = await fetchLatestMessages(
    process.env.FORWARDED_CHANNEL_IDS?.split(" ") ?? [],
    +(process.env.FORWARDED_DAYS ?? 7),
    process.env.MAX_MESSAGES_IN_CHANNEL as number | undefined
  );
  console.log(
    "conversationsHistoryResults.length:",
    conversationsHistoryResults.length
  );
};
main();
